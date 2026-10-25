import { eq, isNull, not, like, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { attendees } from "../db/schema";
import type * as schema from "../db/schema";
import { logger } from "../logger";
import { decrypt, emailLookupHash, encrypt, isEncrypted, normalizeEmail } from "./pii";

const BATCH_SIZE = 500;
const ENCRYPTED = "enc:v1:%";

type Database = NodePgDatabase<typeof schema>;

/**
 * Encrypts attendee rows written before field encryption existed and fills in email_hash.
 * Idempotent: already-encrypted rows are skipped, so it is safe to re-run.
 */
export async function encryptLegacyAttendees(database: Database): Promise<number> {
	const needsWork = or(
		not(like(attendees.name, ENCRYPTED)),
		not(like(attendees.email, ENCRYPTED)),
		isNull(attendees.emailHash),
	);

	let migrated = 0;
	for (;;) {
		const rows = await database
			.select({ id: attendees.id, name: attendees.name, email: attendees.email })
			.from(attendees)
			.where(needsWork)
			.limit(BATCH_SIZE);
		if (rows.length === 0) break;

		for (const row of rows) {
			const email = normalizeEmail(decrypt(row.email));
			await database
				.update(attendees)
				.set({
					name: isEncrypted(row.name) ? row.name : encrypt(row.name),
					email: isEncrypted(row.email) ? row.email : encrypt(email),
					emailHash: emailLookupHash(email),
				})
				.where(eq(attendees.id, row.id));
		}
		migrated += rows.length;
		logger.info(`Encrypted ${migrated} attendee row(s) so far`);
	}
	return migrated;
}
