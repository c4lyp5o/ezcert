import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { events } from "../src/db/schema";
import { testDb } from "./setup";
import {
	MISSING_UUID,
	call,
	createAttendee,
	createEvent,
	createTenant,
	tenantSession,
} from "./helpers";

const newEvent = {
	name: "Townhall",
	date: "2026-11-01T01:00:00.000Z",
	location: "Auditorium",
	template: "tech-dark",
};

describe("admin routes require a tenant session", () => {
	test.each([
		["GET", "/api/v1/admin/events", undefined],
		["POST", "/api/v1/admin/events", newEvent],
		["PATCH", "/api/v1/admin/tenant", { name: "x", email: "x@example.com" }],
		["PATCH", `/api/v1/admin/events/status/${MISSING_UUID}`, { isOpen: true }],
		["DELETE", `/api/v1/admin/events/${MISSING_UUID}`, undefined],
	])("%s %s → 401", async (method, path, body) => {
		expect((await call(method, path, { body })).status).toBe(401);
	});
});

describe("events", () => {
	test("creates an event owned by the session tenant, ignoring a spoofed tenantId", async () => {
		const { tenant, cookie } = await tenantSession();
		const victim = await createTenant();

		const res = await call("POST", "/api/v1/admin/events", {
			cookie,
			body: { ...newEvent, tenantId: victim.id },
		});
		const created = await res.json();

		expect(res.status).toBe(200);
		expect(created).toMatchObject({
			tenantId: tenant.id,
			name: "Townhall",
			template: "tech-dark",
			isOpen: false,
			attendees: [],
		});
	});

	test("rejects unknown templates and non-ISO dates", async () => {
		const { cookie } = await tenantSession();
		const badTemplate = await call("POST", "/api/v1/admin/events", {
			cookie,
			body: { ...newEvent, template: "comic-sans" },
		});
		const badDate = await call("POST", "/api/v1/admin/events", {
			cookie,
			body: { ...newEvent, date: "next tuesday" },
		});
		expect(badTemplate.status).toBe(422);
		expect(badDate.status).toBe(422);
	});

	test("lists only the tenant's own events, newest first, with attendees", async () => {
		const { tenant, cookie } = await tenantSession();
		const other = await createTenant();
		const older = await createEvent(tenant.id, { name: "Old", date: new Date("2025-01-01") });
		const newer = await createEvent(tenant.id, { name: "New", date: new Date("2026-01-01") });
		await createEvent(other.id, { name: "Not mine" });
		await createAttendee(newer.id, "Ali");

		const list = await (await call("GET", "/api/v1/admin/events", { cookie })).json();

		expect(list.map((e: { id: string }) => e.id)).toEqual([newer.id, older.id]);
		expect(list[0].attendees).toHaveLength(1);
		expect(list[0].attendees[0]).toMatchObject({ name: "Ali" });
	});

	test("toggles check-in status on an owned event", async () => {
		const { tenant, cookie } = await tenantSession();
		const event = await createEvent(tenant.id, { isOpen: false });

		const res = await call("PATCH", `/api/v1/admin/events/status/${event.id}`, {
			cookie,
			body: { isOpen: true },
		});

		expect(await res.json()).toMatchObject({ id: event.id, isOpen: true });
	});

	test("cannot toggle or delete another tenant's event", async () => {
		const { cookie } = await tenantSession();
		const other = await createTenant();
		const foreign = await createEvent(other.id, { isOpen: false });

		const toggle = await call("PATCH", `/api/v1/admin/events/status/${foreign.id}`, {
			cookie,
			body: { isOpen: true },
		});
		const del = await call("DELETE", `/api/v1/admin/events/${foreign.id}`, { cookie });

		expect(toggle.status).toBe(404);
		expect(del.status).toBe(404);
		const stillThere = await testDb.query.events.findFirst({
			where: eq(events.id, foreign.id),
		});
		expect(stillThere?.isOpen).toBe(false);
	});

	test("deletes an owned event and cascades its attendees", async () => {
		const { tenant, cookie } = await tenantSession();
		const event = await createEvent(tenant.id);
		await createAttendee(event.id);

		const res = await call("DELETE", `/api/v1/admin/events/${event.id}`, { cookie });

		expect(await res.json()).toEqual({ success: true });
		expect(await testDb.query.attendees.findMany()).toHaveLength(0);
	});

	test("returns 422 for a malformed event id", async () => {
		const { cookie } = await tenantSession();
		const res = await call("DELETE", "/api/v1/admin/events/not-a-uuid", { cookie });
		expect(res.status).toBe(422);
	});
});

describe("tenant profile", () => {
	test("updates name and email and returns the safe profile", async () => {
		const { tenant, cookie } = await tenantSession();
		const res = await call("PATCH", "/api/v1/admin/tenant", {
			cookie,
			body: { name: "Renamed Clinic", email: "renamed@example.com" },
		});

		expect(await res.json()).toEqual({
			id: tenant.id,
			name: "Renamed Clinic",
			email: "renamed@example.com",
		});
	});

	test("keeping your own email is allowed", async () => {
		const { tenant, cookie } = await tenantSession();
		const res = await call("PATCH", "/api/v1/admin/tenant", {
			cookie,
			body: { name: "Same Email", email: tenant.email },
		});
		expect(res.status).toBe(200);
	});

	test("returns 409 when the email belongs to another tenant", async () => {
		const { cookie } = await tenantSession();
		const other = await createTenant();
		const res = await call("PATCH", "/api/v1/admin/tenant", {
			cookie,
			body: { name: "Thief", email: other.email },
		});
		expect(res.status).toBe(409);
	});
});
