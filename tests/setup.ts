// Preloaded by bunfig.toml before every test file.
// Swaps the real Postgres connection for in-memory PGlite and stubs outgoing email.
import { afterAll, beforeEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { pushSchema } from "drizzle-kit/api";

import * as schema from "../src/db/schema";

// Must be set before src/logger.ts is first imported (by the test files).
// Forced because bun auto-loads .env; use TEST_LOG_LEVEL=debug to see logs.
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? "silent";
// Fixed test-only key (32 zero-padded bytes); never the real one from .env
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.TRUST_PROXY = "true";
// Uploaded files go to a throwaway directory (read by src/storage.ts at import time)
export const uploadDir = mkdtempSync(join(tmpdir(), "ezcert-test-uploads-"));
process.env.UPLOAD_DIR = uploadDir;
afterAll(() => rmSync(uploadDir, { recursive: true, force: true }));

export const testDb = drizzle(new PGlite(), { schema });

const { apply } = await pushSchema(schema, testDb as never);
await apply();

mock.module("../src/db", () => ({ db: testDb }));

type Mail = { to: string; subject: string; html: string };

export const mailbox = {
	sent: [] as Mail[],
	shouldFail: false,
};

mock.module("nodemailer", () => ({
	default: {
		createTransport: () => ({
			sendMail: async (message: Mail) => {
				if (mailbox.shouldFail) throw new Error("SMTP unavailable");
				mailbox.sent.push(message);
			},
		}),
	},
}));

beforeEach(async () => {
	mailbox.sent = [];
	mailbox.shouldFail = false;
	await testDb.execute(
		sql`TRUNCATE attendees, events, designs, assets, tenants, super_admins RESTART IDENTITY CASCADE`,
	);
});
