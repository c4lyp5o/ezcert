import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	hkdfSync,
	randomBytes,
} from "node:crypto";

// Field-level encryption for participant personal data (names, emails).
// A leaked database or backup is unreadable without DATA_ENCRYPTION_KEY, which lives outside the DB.
// LOSING THE KEY MEANS LOSING THE DATA: back it up separately from the database.

const PREFIX = "enc:v1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

type Keys = { encryption: Buffer; lookup: Buffer };
let cached: Keys | null = null;

const generateHint =
	'Generate one with: bun -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(\'base64\'))"';

function keys(): Keys {
	if (cached) return cached;
	const raw = process.env.DATA_ENCRYPTION_KEY;
	if (!raw) throw new Error(`DATA_ENCRYPTION_KEY is not set. ${generateHint}`);

	const master = Buffer.from(raw, "base64");
	if (master.length !== KEY_BYTES) {
		throw new Error(`DATA_ENCRYPTION_KEY must be ${KEY_BYTES} bytes, base64-encoded. ${generateHint}`);
	}
	// Separate sub-keys so the lookup hash can never be used to decrypt anything
	const derive = (info: string) =>
		Buffer.from(hkdfSync("sha256", master, "ezcert", info, KEY_BYTES));
	cached = { encryption: derive("pii-encryption-v1"), lookup: derive("pii-lookup-v1") };
	return cached;
}

/** Fails fast at startup instead of at the first check-in. */
export function assertEncryptionConfigured(): void {
	keys();
}

export const isEncrypted = (value: string) => value.startsWith(PREFIX);

export function encrypt(plaintext: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", keys().encryption, iv);
	const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/**
 * Decrypts a value written by encrypt(). Plaintext from before encryption was enabled is
 * returned unchanged, so un-migrated rows keep working. Throws on tampering or a wrong key.
 */
export function decrypt(value: string): string {
	if (!isEncrypted(value)) return value;
	const raw = Buffer.from(value.slice(PREFIX.length), "base64url");
	const iv = raw.subarray(0, IV_BYTES);
	const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
	const decipher = createDecipheriv("aes-256-gcm", keys().encryption, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

// ---- Malaysian IC (MyKad): YYMMDD-PB-###G, collected only for events that need it (CPD) ----

/** Strips spaces/dashes; returns the 12 digits or null if it isn't a plausible MyKad number. */
export function normalizeIc(input: string): string | null {
	const digits = input.replace(/[\s-]/g, "");
	if (!/^\d{12}$/.test(digits)) return null;
	const month = Number(digits.slice(2, 4));
	const day = Number(digits.slice(4, 6));
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	return digits;
}

/** Display form that never reveals more than the last 4 digits. */
export const maskIc = (ic: string) => `******-**-${ic.slice(-4)}`;

/** Full IC with dashes, for the organiser's CPD export and the {{ic}} certificate placeholder. */
export const formatIc = (ic: string) => `${ic.slice(0, 6)}-${ic.slice(6, 8)}-${ic.slice(8)}`;

/** Certificate placeholder values for a stored (encrypted) IC; blank when none was collected. */
export function icPlaceholderValues(storedIc: string | null): { ic: string; ic_masked: string } {
	if (!storedIc) return { ic: "", ic_masked: "" };
	const ic = decrypt(storedIc);
	return { ic: formatIc(ic), ic_masked: maskIc(ic) };
}

/** Deterministic keyed fingerprint for finding a participant by email without decrypting. */
export const emailLookupHash = (email: string) =>
	createHmac("sha256", keys().lookup).update(normalizeEmail(email)).digest("base64url");

/** For tests: forget the cached keys so a changed DATA_ENCRYPTION_KEY takes effect. */
export function resetKeyCache(): void {
	cached = null;
}
