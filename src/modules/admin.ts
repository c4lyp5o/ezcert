import { Elysia, t } from "elysia";
import { and, desc, eq, ne } from "drizzle-orm";

import { db } from "../db";
import { attendees, designs, events, tenants } from "../db/schema";
import { authPlugin } from "../plugins/auth";
import { logger, maskEmail } from "../logger";
import { TEMPLATE_IDS } from "../cert-templates";
import { decrypt, formatIc, maskIc } from "../crypto/pii";

const eventParams = t.Object({ id: t.String({ format: "uuid" }) });
const attendeeParams = t.Object({
	id: t.String({ format: "uuid" }),
	attendeeId: t.String({ format: "uuid" }),
});

const UNREADABLE = "[unreadable]";

/** Decrypts for display; a bad key or corrupt value shows a marker instead of breaking the list. */
function readable(value: string): string {
	try {
		return decrypt(value);
	} catch (error) {
		logger.error("Failed to decrypt participant data (wrong DATA_ENCRYPTION_KEY?)", error);
		return UNREADABLE;
	}
}

const ownedEvent = (tenantId: string, id: string) =>
	db.query.events.findFirst({
		where: and(eq(events.id, id), eq(events.tenantId, tenantId)),
		columns: { id: true, name: true, collectIc: true },
	});

// Quote every cell; prefix formula-like values to avoid CSV injection in Excel
const csvCell = (value: string) =>
	`"${(/^[=+\-@]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
const designIdField = t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()]));

/** A tenant may only attach its own designs to its events. */
const ownsDesign = async (tenantId: string, designId: string | null | undefined) =>
	!designId ||
	!!(await db.query.designs.findFirst({
		where: and(eq(designs.id, designId), eq(designs.tenantId, tenantId)),
		columns: { id: true },
	}));

const adminModule = new Elysia({ prefix: "/api/v1/admin" })
	.use(authPlugin)
	.guard({ adminAuth: true })
	.patch(
		"/tenant",
		async ({ user, body, status }) => {
			const taken = await db.query.tenants.findFirst({
				where: and(eq(tenants.email, body.email), ne(tenants.id, user.tenantId)),
				columns: { id: true },
			});
			if (taken) {
				logger.warn(`Tenant ${user.tenantId} tried to take in-use email ${maskEmail(body.email)}`);
				return status(409, "Email already in use");
			}

			const [tenant] = await db
				.update(tenants)
				.set({ name: body.name, email: body.email })
				.where(eq(tenants.id, user.tenantId))
				.returning({ id: tenants.id, name: tenants.name, email: tenants.email });

			logger.info(`Tenant profile updated: ${user.tenantId}`);
			return tenant;
		},
		{
			body: t.Object({
				name: t.String({ minLength: 1, maxLength: 200 }),
				email: t.String({ format: "email" }),
			}),
		},
	)
	.get("/events", async ({ user }) => {
		const rows = await db.query.events.findMany({
			where: eq(events.tenantId, user.tenantId),
			orderBy: [desc(events.date)],
			with: {
				attendees: {
					columns: { id: true, name: true, email: true, ic: true, createdAt: true },
				},
			},
		});
		// Full IC never leaves the server here; only the CPD CSV export includes it
		return rows.map((event) => ({
			...event,
			attendees: event.attendees.map(({ name, email, ic, ...rest }) => {
				const plainIc = ic ? readable(ic) : null;
				return {
					...rest,
					name: readable(name),
					email: readable(email),
					icMasked: plainIc && plainIc !== UNREADABLE ? maskIc(plainIc) : plainIc,
				};
			}),
		}));
	})
	.get(
		"/events/:id/attendees.csv",
		async ({ user, params: { id }, status }) => {
			const event = await ownedEvent(user.tenantId, id);
			if (!event) return status(404, "Event not found or access denied");

			const rows = await db
				.select({ name: attendees.name, email: attendees.email, ic: attendees.ic, createdAt: attendees.createdAt })
				.from(attendees)
				.where(eq(attendees.eventId, id))
				.orderBy(attendees.createdAt);

			const header = ["Name", "Email", ...(event.collectIc ? ["IC Number"] : []), "Checked in at"];
			const lines = rows.map((r) => {
				const ic = r.ic ? readable(r.ic) : "";
				return [
					readable(r.name),
					readable(r.email),
					...(event.collectIc ? [ic && ic !== UNREADABLE ? formatIc(ic) : ic] : []),
					r.createdAt?.toISOString() ?? "",
				];
			});
			const csv = [header, ...lines].map((row) => row.map(csvCell).join(",")).join("\r\n");

			// Audit trail: who exported identity numbers, and how many
			logger.warn(
				`Attendee export: tenant ${user.tenantId}, event ${id}, ${rows.length} row(s)${event.collectIc ? ", IC numbers included" : ""}`,
			);
			const filename = `attendees-${event.name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60) || "event"}.csv`;
			return new Response(`﻿${csv}`, {
				headers: {
					"content-type": "text/csv; charset=utf-8",
					"content-disposition": `attachment; filename="${filename}"`,
					"cache-control": "no-store",
				},
			});
		},
		{ params: eventParams },
	)
	.delete(
		"/events/:id/attendees/:attendeeId",
		async ({ user, params: { id, attendeeId }, status }) => {
			if (!(await ownedEvent(user.tenantId, id))) {
				return status(404, "Event not found or access denied");
			}
			const deleted = await db
				.delete(attendees)
				.where(and(eq(attendees.id, attendeeId), eq(attendees.eventId, id)))
				.returning({ id: attendees.id });
			if (deleted.length === 0) return status(404, "Participant not found");

			logger.info(`Participant ${attendeeId} deleted from event ${id} by tenant ${user.tenantId}`);
			return { success: true };
		},
		{ params: attendeeParams },
	)
	.delete(
		"/events/:id/attendees",
		async ({ user, params: { id }, status }) => {
			if (!(await ownedEvent(user.tenantId, id))) {
				return status(404, "Event not found or access denied");
			}
			const deleted = await db
				.delete(attendees)
				.where(eq(attendees.eventId, id))
				.returning({ id: attendees.id });

			logger.warn(`All participant data (${deleted.length}) deleted from event ${id} by tenant ${user.tenantId}`);
			return { success: true, deleted: deleted.length };
		},
		{ params: eventParams },
	)
	.patch(
		"/events/:id/settings",
		async ({ user, params: { id }, body, status }) => {
			const [event] = await db
				.update(events)
				.set({ collectIc: body.collectIc })
				.where(and(eq(events.id, id), eq(events.tenantId, user.tenantId)))
				.returning({ id: events.id, collectIc: events.collectIc });
			if (!event) return status(404, "Event not found or access denied");

			logger.info(`Event ${id}: IC collection ${body.collectIc ? "enabled" : "disabled"}`);
			return event;
		},
		{ params: eventParams, body: t.Object({ collectIc: t.Boolean() }) },
	)
	.post(
		"/events",
		async ({ user, body, status }) => {
			if (!(await ownsDesign(user.tenantId, body.designId))) {
				return status(422, "Unknown certificate design");
			}
			const [event] = await db
				.insert(events)
				.values({
					tenantId: user.tenantId,
					name: body.name,
					date: new Date(body.date),
					location: body.location,
					template: body.template,
					designId: body.designId ?? null,
					isOpen: body.isOpen ?? false,
					collectIc: body.collectIc ?? false,
				})
				.returning();

			logger.info(`Event created: ${event.id} by tenant ${user.tenantId}`);
			return { ...event, attendees: [] };
		},
		{
			body: t.Object({
				name: t.String({ minLength: 1, maxLength: 200 }),
				date: t.String({ format: "date-time" }),
				location: t.String({ minLength: 1, maxLength: 200 }),
				template: t.UnionEnum(TEMPLATE_IDS),
				designId: designIdField,
				isOpen: t.Optional(t.Boolean()),
				collectIc: t.Optional(t.Boolean()),
			}),
		},
	)
	.patch(
		"/events/:id/certificate",
		async ({ user, params: { id }, body, status }) => {
			if (!(await ownsDesign(user.tenantId, body.designId))) {
				return status(422, "Unknown certificate design");
			}
			const [event] = await db
				.update(events)
				.set({ template: body.template, designId: body.designId ?? null })
				.where(and(eq(events.id, id), eq(events.tenantId, user.tenantId)))
				.returning({ id: events.id, template: events.template, designId: events.designId });

			if (!event) return status(404, "Event not found or access denied");
			logger.info(`Event ${id} certificate set to ${event.designId ?? event.template}`);
			return event;
		},
		{
			params: eventParams,
			body: t.Object({ template: t.UnionEnum(TEMPLATE_IDS), designId: designIdField }),
		},
	)
	.patch(
		"/events/status/:id",
		async ({ user, params: { id }, body, status }) => {
			// Scoping by tenant in the WHERE clause doubles as the ownership check
			const [event] = await db
				.update(events)
				.set({ isOpen: body.isOpen })
				.where(and(eq(events.id, id), eq(events.tenantId, user.tenantId)))
				.returning();

			if (!event) {
				logger.warn(`Tenant ${user.tenantId} tried to toggle missing/foreign event ${id}`);
				return status(404, "Event not found or access denied");
			}
			logger.info(`Event ${id} check-in ${body.isOpen ? "opened" : "closed"}`);
			return event;
		},
		{
			params: eventParams,
			body: t.Object({ isOpen: t.Boolean() }),
		},
	)
	.delete(
		"/events/:id",
		async ({ user, params: { id }, status }) => {
			const deleted = await db
				.delete(events)
				.where(and(eq(events.id, id), eq(events.tenantId, user.tenantId)))
				.returning({ id: events.id });

			if (deleted.length === 0) {
				logger.warn(`Tenant ${user.tenantId} tried to delete missing/foreign event ${id}`);
				return status(404, "Event not found or access denied");
			}
			logger.info(`Event deleted: ${id} by tenant ${user.tenantId}`);
			return { success: true };
		},
		{ params: eventParams },
	);

export default adminModule;
