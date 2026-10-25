import { describe, expect, test } from "bun:test";

import { testDb } from "./setup";
import { MISSING_UUID, call, createAttendee, createEvent, createTenant } from "./helpers";

const attend = (eventId: string, overrides: Record<string, string> = {}) =>
	call("POST", "/api/v1/events/attend", {
		body: { name: "Jane Doe", email: "jane@example.com", eventId, ...overrides },
	});

describe("public event details", () => {
	test("returns display fields and host name, without tenant internals", async () => {
		const tenant = await createTenant({ name: "Hospital Putrajaya" });
		const event = await createEvent(tenant.id);

		const body = await (await call("GET", `/api/v1/events/${event.id}`)).json();

		expect(body).toMatchObject({
			id: event.id,
			name: event.name,
			location: event.location,
			isOpen: true,
			hostName: "Hospital Putrajaya",
		});
		expect(body).not.toHaveProperty("tenantId");
		expect(body).not.toHaveProperty("template");
	});

	test("404 for unknown event, 422 for malformed id", async () => {
		expect((await call("GET", `/api/v1/events/${MISSING_UUID}`)).status).toBe(404);
		expect((await call("GET", "/api/v1/events/abc")).status).toBe(422);
	});
});

describe("attendance", () => {
	test("records attendance for an open event", async () => {
		const event = await createEvent((await createTenant()).id);
		const body = await (await attend(event.id)).json();

		expect(body.success).toBe(true);
		expect(body.attendeeId).toBeString();
	});

	test("refuses check-in when the event is closed", async () => {
		const event = await createEvent((await createTenant()).id, { isOpen: false });
		const body = await (await attend(event.id)).json();

		expect(body).toEqual({ success: false, message: "Check-in for this event is closed" });
		expect(await testDb.query.attendees.findMany()).toHaveLength(0);
	});

	test("re-submitting the same email (any case) returns the same attendee", async () => {
		const event = await createEvent((await createTenant()).id);
		const first = await (await attend(event.id)).json();
		const second = await (await attend(event.id, { email: "JANE@Example.com" })).json();

		expect(second.attendeeId).toBe(first.attendeeId);
		expect(await testDb.query.attendees.findMany()).toHaveLength(1);
	});

	test("404 for an unknown event, 422 for invalid input", async () => {
		expect((await attend(MISSING_UUID)).status).toBe(404);
		expect((await attend("nope")).status).toBe(422);
		const event = await createEvent((await createTenant()).id);
		expect((await attend(event.id, { email: "not-an-email" })).status).toBe(422);
		expect((await attend(event.id, { name: "" })).status).toBe(422);
	});
});

describe("certificate", () => {
	test("streams a PDF with a header-safe filename", async () => {
		const event = await createEvent((await createTenant()).id, { template: "elegant-gold" });
		const attendee = await createAttendee(event.id, 'Dr. "Ali" Ömer\r\nX-Evil: 1');

		const res = await call("GET", `/api/v1/events/certificate/${attendee.id}`);
		const pdf = Buffer.from(await res.arrayBuffer());

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/pdf");
		expect(res.headers.get("content-disposition")).toBe(
			'attachment; filename="certificate-Dr-Ali-merX-Evil-1.pdf"',
		);
		expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
	});

	test("404 for unknown attendee, 422 for malformed id", async () => {
		expect((await call("GET", `/api/v1/events/certificate/${MISSING_UUID}`)).status).toBe(404);
		expect((await call("GET", "/api/v1/events/certificate/xyz")).status).toBe(422);
	});
});
