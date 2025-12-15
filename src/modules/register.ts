import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { tenants } from "../db/schema";

const registrationModule = new Elysia().post(
	"/api/v1/register",
	async ({ body }) => {
		const existing = await db
			.select()
			.from(tenants)
			.where(eq(tenants.email, body.email));
		if (existing.length > 0) {
			return { success: false, message: "Email already registered" };
		}

		const hashedPassword = await Bun.password.hash(body.password);

		await db.insert(tenants).values({
			name: body.tenantName,
			email: body.email,
			password: hashedPassword,
			status: "PENDING",
		});

		return {
			success: true,
			message: "Registration submitted for review",
		};
	},
	{
		body: t.Object({
			tenantName: t.String(),
			email: t.String(),
			password: t.String(),
		}),
	},
);

export default registrationModule;
