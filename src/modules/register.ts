import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { tenants } from "../db/schema";
import { logger, maskEmail } from "../logger";

const registrationModule = new Elysia().post(
	"/api/v1/register",
	async ({ body }) => {
		const existing = await db.query.tenants.findFirst({
			where: eq(tenants.email, body.email),
			columns: { id: true },
		});
		if (existing) {
			logger.warn(`Registration refused, email already registered: ${maskEmail(body.email)}`);
			return { success: false, message: "Email already registered" };
		}

		const hashedPassword = await Bun.password.hash(body.password);

		await db.insert(tenants).values({
			name: body.tenantName,
			email: body.email,
			password: hashedPassword,
			status: "PENDING",
		});

		logger.info(`New tenant registration pending review: ${maskEmail(body.email)}`);
		return {
			success: true,
			message: "Registration submitted for review",
		};
	},
	{
		body: t.Object({
			tenantName: t.String({ minLength: 1, maxLength: 200 }),
			email: t.String({ format: "email", maxLength: 254 }),
			password: t.String({ minLength: 8, maxLength: 128 }),
		}),
	},
);

export default registrationModule;
