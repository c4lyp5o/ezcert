import { db } from "../src/db";
import { superAdmins } from "../src/db/schema";

const username = "***REMOVED***";
const password = "***REMOVED***";

const hashedPassword = await Bun.password.hash(password);

await db.insert(superAdmins).values({
	username,
	password: hashedPassword,
});

console.log(`❖ Superadmin [${username}] has been inscribed.`);
