// server/src/db/index.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { resolveSsl } from "./ssl";
import { logger } from "../logger";

// No top-level await in this module (or src/index.ts): PM2's Bun wrapper loads the entry with
// require(), and Bun refuses to require() a module whose top-level await really suspends.
// Startup therefore waits on `dbReady` instead (see tests/pm2-load.test.ts).

const tls = resolveSsl(process.env);
if (tls.error) {
	logger.fatal(tls.error);
	void logger.flush().finally(() => process.exit(1));
} else if (tls.warning) {
	logger.warn(tls.warning);
}

const pool = new Pool({
	connectionString: process.env.POSTGRES_URL,
	...(tls.ssl === undefined ? {} : { ssl: tls.ssl }),
});

// A dropped idle connection would otherwise crash the process with no context
pool.on("error", (err) => logger.error("Postgres pool error", err));

export const db = drizzle(pool, { schema });

/** Resolves once the database is reachable; exits the process if it isn't (or the TLS policy refused). */
export const dbReady: Promise<void> = tls.error
	? new Promise<void>(() => {}) // never connect when the TLS policy refused; the process is exiting
	: pool.query("select 1").then(
			() => logger.success(`Connected to Postgres (${tls.encrypted ? "TLS" : "unencrypted"})`),
			async (err) => {
				logger.fatal("Failed to connect to Postgres (check POSTGRES_URL / DB_SSL)", err);
				await logger.flush();
				process.exit(1);
			},
		);
