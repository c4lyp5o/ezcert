import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";

import { db } from "../db";
import { events, tenants } from "../db/schema";
import { activationEmailTemplate } from "../email-templates";

const transporter = nodemailer.createTransport({
	host: process.env.EMAIL_HOST || "***REMOVED***",
	port: process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 587,
	secure: process.env.EMAIL_SECURE === "true", // true for 465, false for other ports
	auth: {
		user: process.env.EMAIL_USER || "***REMOVED***",
		pass: process.env.EMAIL_PASS || "***REMOVED***",
	},
});

const superadminsModule = new Elysia({ prefix: "/api/v1/superadmin" })
	.macro({
		jwtAuth: (enabled: true) => ({
			resolve: async ({ jwtSuper, cookie: { super_token }, status }) => {
				console.log("Superadmin JWT Auth Macro Invoked");
				const token = super_token.value;
				if (!token) return status(401, "No cookie found");

				const profile = await jwtSuper.verify(token);
				// console.log("Verified superadmin profile:", profile);
				if (!profile) return status(401, "Invalid token");
				return { user: profile };
			},
		}),
	})
	.get(
		"/pending",
		async () => {
			return await db
				.select()
				.from(tenants)
				.where(eq(tenants.status, "PENDING"));
		},
		{ jwtAuth: true },
	)
	.post(
		"/approve",
		async ({ jwtMagic, body }) => {
			const result = await db
				.update(tenants)
				.set({ status: "AWAITING_ACTIVATION" })
				.where(eq(tenants.email, body.email))
				.returning();

			if (result.length === 0) return { error: "Tenant not found" };

			const tenant = result[0];

			const token = await jwtMagic.sign({ tenantId: tenant.id });
			// 2. Generate "Magic Link" (Simulated)
			// In production, this would be a JWT token valid for 1 hour
			// const magicLink = `http://localhost:3000/login?token=magic-${tenant.id}`;
			const activationLink = `${process.env.DOMAIN_NAME}/activate?token=${token}`;

			// 3. Send Email
			await transporter.sendMail({
				from: '"EzCert Admin" <admin@ezcert.com>',
				to: tenant.email,
				subject: "Action Required: Activate your EzCert Account",
				html: activationEmailTemplate(activationLink),
			});

			return { success: true, message: "Approved email sent" };
		},
		{
			jwtAuth: true,
			body: t.Object({ email: t.String() }),
		},
	)
	.post(
		"/reject",
		async ({ body }) => {
			await db
				.update(tenants)
				.set({ status: "REJECTED" })
				.where(eq(tenants.email, body.email));

			return { success: true, message: "Registration rejected." };
		},
		{
			jwtAuth: true,
			body: t.Object({ email: t.String() }),
		},
	)
	.get(
		"/events",
		async () => {
			const result = await db.select().from(events).orderBy(events.date);
			return result;
		},
		{ jwtAuth: true },
	)
	.get(
		"/souls",
		async () => {
			// We want all tenants that are NOT pending
			// We also want to count their events
			// Ideally we use a 'group by', but for simplicity with relations:
			const souls = await db.query.tenants.findMany({
				where: (tenants, { ne }) => ne(tenants.status, "PENDING"),
				with: {
					events: {
						columns: { id: true },
					},
				},
			});

			return souls.map((s) => ({
				id: s.id,
				name: s.name,
				email: s.email,
				status: s.status,
				conjurations: s.events.length,
			}));
		},
		{ jwtAuth: true },
	)
	.delete(
		"/souls/:id",
		async ({ params: { id } }) => {
			// Due to ON DELETE CASCADE in the schema, deleting the tenant will
			// automatically delete associated events and attendees.
			await db.delete(tenants).where(eq(tenants.id, id));

			return { success: true, message: "Soul vanquished" };
		},
		{ jwtAuth: true },
	);

export default superadminsModule;
