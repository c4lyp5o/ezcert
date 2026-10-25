// server/src/db/index.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "./schema";
import { resolveSsl } from "./ssl";
import { logger } from "../logger";

const tls = resolveSsl(process.env);
if (tls.error) {
	logger.fatal(tls.error);
	await logger.flush();
	process.exit(1);
}
if (tls.warning) logger.warn(tls.warning);

const client = new Client({
	connectionString: process.env.POSTGRES_URL,
	...(tls.ssl === undefined ? {} : { ssl: tls.ssl }),
});

// A dropped connection would otherwise crash the process with no context
client.on("error", (err) => logger.error("Postgres client error", err));

try {
	await client.connect();
	logger.success(`Connected to Postgres (${tls.encrypted ? "TLS" : "unencrypted"})`);
} catch (err) {
	logger.fatal("Failed to connect to Postgres (check POSTGRES_URL / DB_SSL)", err);
	await logger.flush();
	process.exit(1);
}

export const db = drizzle(client, { schema });
