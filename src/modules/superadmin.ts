import { Elysia, t } from "elysia";
import { and, eq, inArray } from "drizzle-orm";
import nodemailer from "nodemailer";

import { db } from "../db";
import { events, tenants } from "../db/schema";
import { activationEmailTemplate } from "../email-templates";
import { authPlugin } from "../plugins/auth";
import { logger, maskEmail } from "../logger";

const transporter = nodemailer.createTransport({
	host: process.env.EMAIL_HOST,
	port: process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 587,
	secure: process.env.EMAIL_SECURE === "true", // true for 465, false for other ports
	auth: {
		user: process.env.EMAIL_USER,
		// .env.example documents EMAIL_PASSWORD; EMAIL_PASS kept for backward compat
		pass: process.env.EMAIL_PASSWORD || process.env.EMAIL_PASS,
	},
});

const tenantColumns = {
	id: tenants.id,
	name: tenants.name,
	email: tenants.email,
	status: tenants.status,
	createdAt: tenants.createdAt,
};

const superadminsModule = new Elysia({ prefix: "/api/v1/superadmin" })
	.use(authPlugin)
	.guard({ superAuth: true })
	.get("/pending", () =>
		db
			.select(tenantColumns)
			.from(tenants)
			.where(eq(tenants.status, "PENDING"))
			.orderBy(tenants.createdAt),
	)
	.post(
		"/approve",
		async ({ jwtMagic, body, status }) => {
			// AWAITING_ACTIVATION is allowed so approving again re-sends the email
			const [tenant] = await db
				.update(tenants)
				.set({ status: "AWAITING_ACTIVATION" })
				.where(
					and(
						eq(tenants.email, body.email),
						inArray(tenants.status, ["PENDING", "AWAITING_ACTIVATION"]),
					),
				)
				.returning();

			if (!tenant) return status(404, "Tenant not found or already processed");

			const token = await jwtMagic.sign({ tenantId: tenant.id });
			const activationLink = `${process.env.DOMAIN_NAME}/activate?token=${token}`;

			try {
				await transporter.sendMail({
					from: process.env.EMAIL_FROM || '"EzCert Admin" <admin@ezcert.com>',
					to: tenant.email,
					subject: "Action Required: Activate your EzCert Account",
					html: activationEmailTemplate(activationLink),
				});
			} catch (error) {
				logger.error(`Failed to send activation email to ${maskEmail(tenant.email)}`, error);
				return status(
					502,
					"Approved, but the activation email failed to send. Approve again to retry.",
				);
			}

			logger.info(`Tenant approved, activation email sent: ${maskEmail(tenant.email)}`);
			return { success: true, message: "Approved email sent" };
		},
		{
			body: t.Object({ email: t.String() }),
		},
	)
	.post(
		"/reject",
		async ({ body, status }) => {
			const rejected = await db
				.update(tenants)
				.set({ status: "REJECTED" })
				.where(and(eq(tenants.email, body.email), eq(tenants.status, "PENDING")))
				.returning({ id: tenants.id });

			if (rejected.length === 0) return status(404, "Pending tenant not found");
			logger.info(`Tenant registration rejected: ${maskEmail(body.email)}`);
			return { success: true, message: "Registration rejected." };
		},
		{
			body: t.Object({ email: t.String() }),
		},
	)
	.get("/events", () => db.select().from(events).orderBy(events.date))
	.get("/souls", async () => {
		// All non-pending tenants, with their event count
		const souls = await db.query.tenants.findMany({
			where: (tenants, { ne }) => ne(tenants.status, "PENDING"),
			columns: { id: true, name: true, email: true, status: true },
			with: { events: { columns: { id: true } } },
		});

		return souls.map(({ events, ...soul }) => ({
			...soul,
			conjurations: events.length,
		}));
	})
	.delete(
		"/souls/:id",
		async ({ params: { id }, status }) => {
			// ON DELETE CASCADE removes the tenant's events and attendees
			const deleted = await db
				.delete(tenants)
				.where(eq(tenants.id, id))
				.returning({ id: tenants.id });

			if (deleted.length === 0) return status(404, "Soul not found");
			logger.warn(`Tenant ${id} deleted by superadmin (events and attendees cascaded)`);
			return { success: true, message: "Soul vanquished" };
		},
		{ params: t.Object({ id: t.String({ format: "uuid" }) }) },
	);

export default superadminsModule;
