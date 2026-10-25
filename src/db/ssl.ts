import type { ConnectionOptions } from "node:tls";

export type SslDecision = {
	ssl: false | ConnectionOptions | undefined;
	encrypted: boolean;
	error?: string;
	warning?: string;
};

type Env = Record<string, string | undefined>;

const SSL_MODES = ["verify", "no-verify", "disable"] as const;

/**
 * Decides how the app connects to Postgres.
 *   DB_SSL=verify     TLS with certificate verification (default in production, unless DB_ALLOW_INSECURE=true)
 *   DB_SSL=no-verify  TLS without verification (self-signed certs; still encrypts traffic)
 *   DB_SSL=disable    no TLS; refused in production unless DB_ALLOW_INSECURE=true
 * An `sslmode` in POSTGRES_URL takes precedence (the pg driver applies it).
 */
export function resolveSsl(env: Env): SslDecision {
	const production = env.NODE_ENV === "production";
	const urlMode = env.POSTGRES_URL?.match(/[?&]sslmode=([a-z-]+)/i)?.[1]?.toLowerCase();

	if (urlMode) {
		const encrypted = urlMode !== "disable";
		return production && !encrypted && env.DB_ALLOW_INSECURE !== "true"
			? { ssl: undefined, encrypted, error: "POSTGRES_URL sets sslmode=disable in production" }
			: { ssl: undefined, encrypted };
	}

	// Production defaults to verified TLS; DB_ALLOW_INSECURE=true alone is the explicit opt-out
	const defaultMode = production && env.DB_ALLOW_INSECURE !== "true" ? "verify" : "disable";
	const mode = (env.DB_SSL ?? defaultMode).toLowerCase();
	if (!(SSL_MODES as readonly string[]).includes(mode)) {
		return { ssl: false, encrypted: false, error: `DB_SSL must be one of ${SSL_MODES.join(", ")}` };
	}

	if (mode === "verify") return { ssl: { rejectUnauthorized: true }, encrypted: true };
	if (mode === "no-verify") {
		return {
			ssl: { rejectUnauthorized: false },
			encrypted: true,
			warning: "Postgres TLS certificate is not verified (DB_SSL=no-verify)",
		};
	}

	const warning =
		"Postgres connection is NOT encrypted: names and emails travel in plaintext. Enable SSL on the server and set DB_SSL=verify.";
	if (production && env.DB_ALLOW_INSECURE !== "true") {
		return {
			ssl: false,
			encrypted: false,
			error: "Refusing an unencrypted database connection in production. Set DB_SSL=verify (or DB_ALLOW_INSECURE=true only if the database is on a private network).",
		};
	}
	return { ssl: false, encrypted: false, warning };
}
