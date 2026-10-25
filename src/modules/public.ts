import { Elysia, t } from "elysia";
import { and, eq, or } from "drizzle-orm";

import { buildCertificate } from "../designs/certificate";
import {
	decrypt,
	emailLookupHash,
	encrypt,
	icPlaceholderValues,
	normalizeEmail,
	normalizeIc,
} from "../crypto/pii";

import { db } from "../db";
import { events, attendees } from "../db/schema";
import { logger } from "../logger";
import { createRateLimiter } from "../plugins/rate-limit";

const uuidParam = t.String({ format: "uuid" });

// Generous because a whole room may check in from one venue Wi-Fi (shared IP);
// it only needs to stop scripted floods.
const CHECK_INS_PER_MINUTE = 60;
const allowCheckIn = createRateLimiter(CHECK_INS_PER_MINUTE, 60_000);

/** Client IP; X-Forwarded-For is only trusted behind a reverse proxy (TRUST_PROXY=true). */
function clientIp(request: Request, server: { requestIP(r: Request): { address: string } | null } | null) {
	if (process.env.TRUST_PROXY === "true") {
		const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
		if (forwarded) return forwarded;
	}
	return server?.requestIP(request)?.address ?? "unknown";
}

// Keep header-safe ASCII only; full name stays inside the PDF itself
const safeFilename = (name: string) =>
	name.replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-") || "attendee";

const formatDate = (date: Date) =>
	date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const publicModule = new Elysia({ prefix: "/api/v1/events" })
	// Public: Get Event Details (no tenant internals)
	.get(
		"/:id",
		async ({ params: { id }, status }) => {
			const event = await db.query.events.findFirst({
				where: eq(events.id, id),
				columns: {
					id: true,
					name: true,
					date: true,
					location: true,
					isOpen: true,
					collectIc: true,
				},
				with: { company: { columns: { name: true } } },
			});
			if (!event) return status(404, "Event not found");

			const { company, ...rest } = event;
			return { ...rest, hostName: company?.name ?? null };
		},
		{ params: t.Object({ id: uuidParam }) },
	)
	// Public: Submit Attendance
	.post(
		"/attend",
		async ({ body, status, request, server }) => {
			if (!allowCheckIn(clientIp(request, server))) {
				return status(429, "Too many check-ins from this network; please wait a minute");
			}

			const event = await db.query.events.findFirst({
				where: eq(events.id, body.eventId),
				columns: { isOpen: true, collectIc: true },
			});
			if (!event) return status(404, "Event not found");
			if (!event.isOpen)
				return { success: false, message: "Check-in for this event is closed" };

			// IC is stored only when the organiser asked for it; otherwise it is discarded unread
			let ic: string | null = null;
			if (event.collectIc) {
				ic = normalizeIc(body.ic ?? "");
				if (!ic) return status(422, "Please enter a valid 12-digit IC number");
			}

			const email = normalizeEmail(body.email);
			const emailHash = emailLookupHash(email);

			// Re-submitting returns the same certificate instead of a duplicate row.
			// The plaintext match covers rows created before encryption was enabled.
			const existing = await db.query.attendees.findFirst({
				where: and(
					eq(attendees.eventId, body.eventId),
					or(eq(attendees.emailHash, emailHash), eq(attendees.email, email)),
				),
				columns: { id: true },
			});
			if (existing) {
				logger.debug(`Repeat check-in for event ${body.eventId}, reusing ${existing.id}`);
				return { success: true, attendeeId: existing.id };
			}

			const [attendee] = await db
				.insert(attendees)
				.values({
					name: encrypt(body.name.trim()),
					email: encrypt(email),
					emailHash,
					ic: ic ? encrypt(ic) : null,
					eventId: body.eventId,
				})
				.returning({ id: attendees.id });

			logger.info(`Attendee ${attendee.id} checked in to event ${body.eventId}`);
			return { success: true, attendeeId: attendee.id };
		},
		{
			body: t.Object({
				name: t.String({ minLength: 1, maxLength: 120 }),
				email: t.String({ format: "email", maxLength: 254 }),
				ic: t.Optional(t.String({ maxLength: 20 })),
				eventId: uuidParam,
			}),
		},
	)
	// Public: confirm a certificate is genuine (target of the QR code / certificate ID).
	// Shows the name only: never email or IC.
	.get(
		"/verify/:attendeeId",
		async ({ params: { attendeeId }, status }) => {
			const attendee = await db.query.attendees.findFirst({
				where: eq(attendees.id, attendeeId),
				columns: { id: true, name: true, createdAt: true },
				with: {
					event: {
						columns: { name: true, date: true, location: true },
						with: { company: { columns: { name: true } } },
					},
				},
			});
			if (!attendee?.event?.company) return status(404, "Certificate not found");

			return {
				valid: true,
				certificateId: attendee.id,
				attendeeName: decrypt(attendee.name),
				eventName: attendee.event.name,
				eventDate: attendee.event.date,
				location: attendee.event.location,
				hostName: attendee.event.company.name,
				issuedAt: attendee.createdAt,
			};
		},
		{ params: t.Object({ attendeeId: uuidParam }) },
	)
	// Generate Certificate (Streamed PDF)
	.get(
		"/certificate/:attendeeId",
		async ({ params: { attendeeId }, set, status }) => {
			const attendee = await db.query.attendees.findFirst({
				where: eq(attendees.id, attendeeId),
				with: { event: { with: { company: true, design: true } } },
			});

			const event = attendee?.event;
			const tenant = event?.company;
			if (!attendee || !event || !tenant)
				return status(404, "Certificate not found");

			const name = decrypt(attendee.name);
			const doc = await buildCertificate({
				tenantId: tenant.id,
				template: event.template,
				// A design only counts if it belongs to the event's own tenant
				layout: event.design?.tenantId === tenant.id ? event.design.layout : null,
				values: {
					attendee_name: name,
					event_name: event.name,
					date: formatDate(event.date),
					location: event.location,
					host_name: tenant.name,
					certificate_id: attendee.id,
					...icPlaceholderValues(attendee.ic),
				},
			});

			set.headers["Content-Type"] = "application/pdf";
			set.headers["Content-Disposition"] =
				`attachment; filename="certificate-${safeFilename(name)}.pdf"`;
			logger.debug(`Certificate generated for attendee ${attendeeId}`);
			return doc;
		},
		{ params: t.Object({ attendeeId: uuidParam }) },
	);

export default publicModule;
