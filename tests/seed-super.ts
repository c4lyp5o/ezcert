// Usage: SUPER_USERNAME=oracle SUPER_PASSWORD='long-secret' bun run db:seed-super
import { db } from "../src/db";
import { superAdmins } from "../src/db/schema";
import { logger } from "../src/logger";

const MIN_PASSWORD_LENGTH = 12;

const username = process.env.SUPER_USERNAME;
const password = process.env.SUPER_PASSWORD;

if (!username || !password || password.length < MIN_PASSWORD_LENGTH) {
	logger.fatal(
		`Set SUPER_USERNAME and SUPER_PASSWORD (min ${MIN_PASSWORD_LENGTH} chars) to seed a superadmin.`,
	);
	await logger.flush();
	process.exit(1);
}

await db.insert(superAdmins).values({
	username,
	password: await Bun.password.hash(password),
});

logger.success(`❖ Superadmin [${username}] has been inscribed.`);
await logger.flush();
// The pg client keeps the event loop alive; exit explicitly
process.exit(0);
