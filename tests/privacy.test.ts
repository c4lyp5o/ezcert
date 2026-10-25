import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
	decrypt,
	emailLookupHash,
	encrypt,
	formatIc,
	icPlaceholderValues,
	maskIc,
	normalizeIc,
	resetKeyCache,
} from "../src/crypto/pii";
import { fillPlaceholders, SAMPLE_VALUES, unknownPlaceholders } from "../src/designs/layout";
import { encryptLegacyAttendees } from "../src/crypto/migrate-attendees";
import { attendees } from "../src/db/schema";
import { resolveSsl } from "../src/db/ssl";
import { maskEmail } from "../src/logger";
import { testDb } from "./setup";
import { MISSING_UUID, call, createEvent, pdfPageCount, tenantSession } from "./helpers";

const VALID_IC = "900101-14-5678";
let ipCounter = 0;
// Each test gets its own client IP so the check-in rate limit never leaks between tests
const freshIp = () => ({ "x-forwarded-for": `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` });

const attend = (eventId: string, extra: Record<string, string> = {}, headers = freshIp()) =>
	call("POST", "/api/v1/events/attend", {
		body: { name: "Siti Nurhaliza", email: "siti@example.com", eventId, ...extra },
		headers,
	});

const rawAttendee = async (id: string) =>
	(await testDb.query.attendees.findFirst({ where: eq(attendees.id, id) }))!;

describe("field encryption", () => {
	test("round-trips and uses a fresh IV every time", () => {
		const a = encrypt("Siti Nurhaliza");
		const b = encrypt("Siti Nurhaliza");
		expect(a).toStartWith("enc:v1:");
		expect(a).not.toBe(b);
		expect(decrypt(a)).toBe("Siti Nurhaliza");
	});

	test("detects tampering", () => {
		const value = encrypt("secret");
		const tampered = value.slice(0, -2) + (value.endsWith("A") ? "BB" : "AA");
		expect(() => decrypt(tampered)).toThrow();
	});

	test("a different key cannot decrypt", () => {
		const value = encrypt("secret");
		const original = process.env.DATA_ENCRYPTION_KEY;
		try {
			process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
			resetKeyCache();
			expect(() => decrypt(value)).toThrow();
		} finally {
			process.env.DATA_ENCRYPTION_KEY = original;
			resetKeyCache();
		}
	});

	test("rejects a missing or wrong-length key", () => {
		const original = process.env.DATA_ENCRYPTION_KEY;
		try {
			process.env.DATA_ENCRYPTION_KEY = "too-short";
			resetKeyCache();
			expect(() => encrypt("x")).toThrow("32 bytes");
			delete process.env.DATA_ENCRYPTION_KEY;
			resetKeyCache();
			expect(() => encrypt("x")).toThrow("DATA_ENCRYPTION_KEY is not set");
		} finally {
			process.env.DATA_ENCRYPTION_KEY = original;
			resetKeyCache();
		}
	});

	test("legacy plaintext passes through decrypt unchanged", () => {
		expect(decrypt("plain old name")).toBe("plain old name");
	});

	test("email lookup hash is case/space-insensitive and reveals nothing", () => {
		const h = emailLookupHash("Siti@Example.com ");
		expect(h).toBe(emailLookupHash("siti@example.com"));
		expect(h).not.toContain("siti");
	});
});

describe("IC helpers", () => {
	test.each([
		["900101-14-5678", "900101145678"],
		["900101145678", "900101145678"],
		[" 900101 14 5678 ", "900101145678"],
		["901301-14-5678", null], // month 13
		["900132-14-5678", null], // day 32
		["90010114567", null], // 11 digits
		["A00101-14-5678", null],
	])("normalizeIc(%p) → %p", (input, expected) => {
		expect(normalizeIc(input)).toBe(expected);
	});

	test("masking and formatting", () => {
		expect(maskIc("900101145678")).toBe("******-**-5678");
		expect(formatIc("900101145678")).toBe("900101-14-5678");
		expect(maskEmail("jane.doe@example.com")).toBe("ja***@example.com");
	});

	test("certificates can print the full IC ({{ic}}) or the masked one ({{ic_masked}})", () => {
		const values = { ...SAMPLE_VALUES, ...icPlaceholderValues(encrypt("900101145678")) };
		expect(unknownPlaceholders("{{ic}} / {{ic_masked}}")).toEqual([]);
		expect(fillPlaceholders("IC: {{ic}} / {{ic_masked}}", values)).toBe("IC: 900101-14-5678 / ******-**-5678");
		// Events that don't collect IC leave both blank
		expect(icPlaceholderValues(null)).toEqual({ ic: "", ic_masked: "" });
	});
});

describe("participant data at rest", () => {
	test("name and email are stored encrypted; IC is not stored unless the event collects it", async () => {
		const { tenant } = await tenantSession();
		const event = await createEvent(tenant.id);
		const { attendeeId } = await (await attend(event.id, { ic: VALID_IC })).json();
		const row = await rawAttendee(attendeeId);

		expect(row.name).toStartWith("enc:v1:");
		expect(row.email).toStartWith("enc:v1:");
		expect(JSON.stringify(row)).not.toContain("Siti");
		expect(JSON.stringify(row)).not.toContain("siti@example.com");
		expect(row.emailHash).toBe(emailLookupHash("siti@example.com"));
		expect(row.ic).toBeNull();
	});

	test("events that collect IC require a valid one and store it encrypted", async () => {
		const { tenant } = await tenantSession();
		const event = await createEvent(tenant.id, { collectIc: true });

		expect((await attend(event.id)).status).toBe(422);
		expect((await attend(event.id, { ic: "901301-14-5678" })).status).toBe(422);

		const { attendeeId } = await (await attend(event.id, { ic: VALID_IC })).json();
		const row = await rawAttendee(attendeeId);
		expect(row.ic).toStartWith("enc:v1:");
		expect(JSON.stringify(row)).not.toContain("5678");
		expect(decrypt(row.ic!)).toBe("900101145678");
	});

	test("public event details tell the form whether to ask for IC", async () => {
		const { tenant } = await tenantSession();
		const event = await createEvent(tenant.id, { collectIc: true });
		const body = await (await call("GET", `/api/v1/events/${event.id}`)).json();
		expect(body.collectIc).toBe(true);
	});

	test("certificates and verification work with encrypted rows; verify never exposes email or IC", async () => {
		const { tenant } = await tenantSession();
		const event = await createEvent(tenant.id, { collectIc: true });
		const { attendeeId } = await (await attend(event.id, { ic: VALID_IC })).json();

		const verify = await (await call("GET", `/api/v1/events/verify/${attendeeId}`)).json();
		expect(verify.attendeeName).toBe("Siti Nurhaliza");
		expect(JSON.stringify(verify)).not.toContain("siti@example.com");
		expect(JSON.stringify(verify)).not.toContain("5678");

		const cert = await call("GET", `/api/v1/events/certificate/${attendeeId}`);
		expect(cert.status).toBe(200);
		expect(cert.headers.get("content-disposition")).toContain("Siti-Nurhaliza");
		expect(pdfPageCount(new Uint8Array(await cert.arrayBuffer()))).toBe(1);
	});
});

describe("organiser access", () => {
	test("dashboard gets decrypted name/email and a masked IC only", async () => {
		const { tenant, cookie } = await tenantSession();
		const event = await createEvent(tenant.id, { collectIc: true });
		await attend(event.id, { ic: VALID_IC });

		const res = await call("GET", "/api/v1/admin/events", { cookie });
		const text = await res.text();
		const [listed] = JSON.parse(text);

		expect(listed.attendees[0]).toMatchObject({
			name: "Siti Nurhaliza",
			email: "siti@example.com",
			icMasked: "******-**-5678",
		});
		expect(text).not.toContain("900101");
		expect(text).not.toContain("enc:v1:");
	});

	test("CSV export includes the full IC for CPD, neutralises formulas, and is owner-only", async () => {
		const { tenant, cookie } = await tenantSession();
		const intruder = await tenantSession();
		const event = await createEvent(tenant.id, { collectIc: true });
		await attend(event.id, { ic: VALID_IC });
		await attend(event.id, { name: "=HYPERLINK(\"http://evil\")", email: "x@example.com", ic: "850615-08-1234" });

		const path = `/api/v1/admin/events/${event.id}/attendees.csv`;
		const res = await call("GET", path, { cookie });
		const csv = await res.text();

		expect(res.headers.get("content-type")).toContain("text/csv");
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(csv).toContain('"Name","Email","IC Number","Checked in at"');
		expect(csv).toContain('"Siti Nurhaliza","siti@example.com","900101-14-5678"');
		expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);

		expect((await call("GET", path)).status).toBe(401);
		expect((await call("GET", path, { cookie: intruder.cookie })).status).toBe(404);
	});

	test("CSV has no IC column when the event doesn't collect IC", async () => {
		const { tenant, cookie } = await tenantSession();
		const event = await createEvent(tenant.id);
		await attend(event.id);
		const csv = await (await call("GET", `/api/v1/admin/events/${event.id}/attendees.csv`, { cookie })).text();
		expect(csv).toContain('"Name","Email","Checked in at"');
		expect(csv).not.toContain("IC");
	});

	test("organiser can turn IC collection on and off; others can't", async () => {
		const { tenant, cookie } = await tenantSession();
		const intruder = await tenantSession();
		const event = await createEvent(tenant.id);
		const path = `/api/v1/admin/events/${event.id}/settings`;

		expect(await (await call("PATCH", path, { cookie, body: { collectIc: true } })).json()).toEqual({
			id: event.id,
			collectIc: true,
		});
		expect((await call("PATCH", path, { cookie: intruder.cookie, body: { collectIc: false } })).status).toBe(404);
	});
});

describe("participant deletion", () => {
	test("organiser deletes one participant; their certificate stops working", async () => {
		const { tenant, cookie } = await tenantSession();
		const event = await createEvent(tenant.id);
		const { attendeeId } = await (await attend(event.id)).json();

		const res = await call("DELETE", `/api/v1/admin/events/${event.id}/attendees/${attendeeId}`, { cookie });

		expect(res.status).toBe(200);
		expect((await call("GET", `/api/v1/events/verify/${attendeeId}`)).status).toBe(404);
		expect((await call("GET", `/api/v1/events/certificate/${attendeeId}`)).status).toBe(404);
	});

	test("another tenant, or the wrong event, can't delete a participant", async () => {
		const { tenant, cookie } = await tenantSession();
		const intruder = await tenantSession();
		const event = await createEvent(tenant.id);
		const otherEvent = await createEvent(tenant.id);
		const { attendeeId } = await (await attend(event.id)).json();

		const asIntruder = await call("DELETE", `/api/v1/admin/events/${event.id}/attendees/${attendeeId}`, {
			cookie: intruder.cookie,
		});
		const wrongEvent = await call("DELETE", `/api/v1/admin/events/${otherEvent.id}/attendees/${attendeeId}`, {
			cookie,
		});
		const missing = await call("DELETE", `/api/v1/admin/events/${event.id}/attendees/${MISSING_UUID}`, { cookie });

		expect(asIntruder.status).toBe(404);
		expect(wrongEvent.status).toBe(404);
		expect(missing.status).toBe(404);
		expect(await testDb.query.attendees.findMany()).toHaveLength(1);
	});

	test("organiser can wipe all participant data for an event", async () => {
		const { tenant, cookie } = await tenantSession();
		const event = await createEvent(tenant.id);
		const keep = await createEvent(tenant.id);
		await attend(event.id);
		await attend(event.id, { email: "two@example.com" });
		await attend(keep.id);

		const res = await call("DELETE", `/api/v1/admin/events/${event.id}/attendees`, { cookie });

		expect(await res.json()).toEqual({ success: true, deleted: 2 });
		expect(await testDb.query.attendees.findMany()).toHaveLength(1);
	});
});

describe("check-in rate limit", () => {
	test("stops floods from one IP without affecting others", async () => {
		const { tenant } = await tenantSession();
		const event = await createEvent(tenant.id);
		const flooder = { "x-forwarded-for": "203.0.113.66" };

		const statuses: number[] = [];
		for (let i = 0; i < 61; i++) {
			statuses.push((await attend(event.id, { email: `bot${i}@example.com` }, flooder)).status);
		}

		expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
		expect(statuses[60]).toBe(429);
		expect((await attend(event.id, { email: "real@example.com" })).status).toBe(200);
	});
});

describe("legacy data migration", () => {
	test("encrypts plaintext rows, fills email_hash, and is idempotent", async () => {
		const { tenant } = await tenantSession();
		const event = await createEvent(tenant.id);
		await testDb.insert(attendees).values([
			{ eventId: event.id, name: "Old Plain", email: "Old@Example.com" },
			{ eventId: event.id, name: "Another", email: "another@example.com" },
		]);

		const db = testDb as unknown as Parameters<typeof encryptLegacyAttendees>[0];
		expect(await encryptLegacyAttendees(db)).toBe(2);
		expect(await encryptLegacyAttendees(db)).toBe(0);

		const rows = await testDb.query.attendees.findMany();
		for (const row of rows) {
			expect(row.name).toStartWith("enc:v1:");
			expect(row.email).toStartWith("enc:v1:");
			expect(row.emailHash).toBeString();
		}

		// Repeat check-in still finds the migrated row by its email
		const again = await (await attend(event.id, { email: "old@example.com", name: "Old Plain" })).json();
		expect(rows.map((r) => r.id)).toContain(again.attendeeId);
	});
});

describe("database TLS policy", () => {
	test("production defaults to verified TLS", () => {
		expect(resolveSsl({ NODE_ENV: "production", POSTGRES_URL: "postgres://h/db" })).toMatchObject({
			ssl: { rejectUnauthorized: true },
			encrypted: true,
		});
	});

	test("production refuses plaintext unless explicitly allowed for a private network", () => {
		const base = { NODE_ENV: "production", POSTGRES_URL: "postgres://h/db", DB_SSL: "disable" };
		expect(resolveSsl(base).error).toContain("Refusing");
		expect(resolveSsl({ ...base, DB_ALLOW_INSECURE: "true" })).toMatchObject({ encrypted: false });
		expect(resolveSsl({ NODE_ENV: "production", POSTGRES_URL: "postgres://h/db?sslmode=disable" }).error).toBeDefined();
	});

	test("development warns about plaintext; sslmode in the URL is respected", () => {
		expect(resolveSsl({ NODE_ENV: "development", POSTGRES_URL: "postgres://h/db" }).warning).toContain("NOT encrypted");
		expect(resolveSsl({ POSTGRES_URL: "postgres://h/db?sslmode=require" })).toMatchObject({ encrypted: true });
		expect(resolveSsl({ DB_SSL: "no-verify" })).toMatchObject({ ssl: { rejectUnauthorized: false } });
		expect(resolveSsl({ DB_SSL: "yes-please" }).error).toBeDefined();
	});
});
