import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import PDFDocument from "pdfkit";

import { generateCertificate } from "../cert-templates";

import { db } from "../db";
import { events, attendees, tenants } from "../db/schema";

const publicModule = new Elysia({ prefix: "/api/v1/events" })
	// 2. Public: Get Event Details
	.get("/:id", async ({ params: { id }, status }) => {
		const result = await db.query.events.findFirst({
			where: eq(events.id, id),
		});
		if (!result) return status(404, "Event not found");
		return result;
	})
	// 3. Public: Submit Attendance
	.post(
		"/attend",
		async ({ body }) => {
			const result = await db
				.insert(attendees)
				.values({
					name: body.name,
					email: body.email,
					eventId: body.eventId,
				})
				.returning({ id: attendees.id });

			return { success: true, attendeeId: result[0].id };
		},
		{
			body: t.Object({
				name: t.String(),
				email: t.String(),
				eventId: t.String(),
			}),
		},
	)
	// 4. Generate Certificate (Streamed PDF)
	.get(
		"/certificate/:attendeeId",
		async ({ params: { attendeeId }, set, status }) => {
			const attendee = await db.query.attendees.findFirst({
				where: eq(attendees.id, attendeeId),
				with: { event: true },
			});

			if (!attendee) return status(404, "Attendee not found");

			const event = attendee.event;
			if (!event) return status(404, "Event not found");
			if (!event.tenantId) return status(404, "Tenant not found");

			const tenant = await db.query.tenants.findFirst({
				where: eq(tenants.id, event.tenantId),
			});
			if (!tenant) return status(404, "Tenant not found");

			const doc = new PDFDocument({ layout: "landscape", size: "A4" });

			set.headers["Content-Type"] = "application/pdf";
			set.headers["Content-Disposition"] =
				`attachment; filename="certificate-${attendee.name}.pdf"`;

			generateCertificate(doc, attendee.event?.template || "", {
				attendeeName: attendee.name,
				tenantName: tenant.name,
				eventName: attendee.event?.name || "",
				date: new Date(attendee.event?.date || "").toLocaleDateString(),
				location: attendee.event?.location || "",
			});

			doc.end();
			return doc;
		},
	);

export default publicModule;
