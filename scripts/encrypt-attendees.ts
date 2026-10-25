// One-off migration: encrypts participant names/emails stored before field encryption.
// Usage: bun run db:encrypt-pii   (needs DATA_ENCRYPTION_KEY and POSTGRES_URL in .env)
import { db } from "../src/db";
import { assertEncryptionConfigured } from "../src/crypto/pii";
import { encryptLegacyAttendees } from "../src/crypto/migrate-attendees";
import { logger } from "../src/logger";

assertEncryptionConfigured();
const migrated = await encryptLegacyAttendees(db);
logger.success(`Done: ${migrated} attendee row(s) encrypted. Back up DATA_ENCRYPTION_KEY now.`);
await logger.flush();
// The pg client keeps the event loop alive; exit explicitly
process.exit(0);
