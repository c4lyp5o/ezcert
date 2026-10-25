import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { tenants } from "../src/db/schema";
import { mailbox, testDb } from "./setup";
import {
	MISSING_UUID,
	call,
	createAttendee,
	createEvent,
	createTenant,
	superSession,
	tenantSession,
} from "./helpers";

const statusOf = async (id: string) =>
	(await testDb.query.tenants.findFirst({ where: eq(tenants.id, id) }))?.status;

describe("superadmin routes require a superadmin session", () => {
	test.each([
		["GET", "/api/v1/superadmin/pending"],
		["GET", "/api/v1/superadmin/souls"],
		["GET", "/api/v1/superadmin/events"],
		["DELETE", `/api/v1/superadmin/souls/${MISSING_UUID}`],
	])("%s %s → 401", async (method, path) => {
		expect((await call(method, path)).status).toBe(401);
	});

	test("a tenant session is not enough", async () => {
		const { cookie } = await tenantSession();
		expect((await call("GET", "/api/v1/superadmin/pending", { cookie })).status).toBe(401);
	});
});

describe("pending queue", () => {
	test("lists PENDING tenants without password hashes", async () => {
		const { cookie } = await superSession();
		const pending = await createTenant({ status: "PENDING" });
		await createTenant({ status: "ACTIVE" });

		const list = await (await call("GET", "/api/v1/superadmin/pending", { cookie })).json();

		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ id: pending.id, status: "PENDING" });
		expect(list[0]).not.toHaveProperty("password");
	});
});

describe("approve", () => {
	test("moves tenant to AWAITING_ACTIVATION and emails an activation link", async () => {
		const { cookie } = await superSession();
		const tenant = await createTenant({ status: "PENDING" });

		const res = await call("POST", "/api/v1/superadmin/approve", {
			cookie,
			body: { email: tenant.email },
		});

		expect(res.status).toBe(200);
		expect(await statusOf(tenant.id)).toBe("AWAITING_ACTIVATION");
		expect(mailbox.sent).toHaveLength(1);
		expect(mailbox.sent[0].to).toBe(tenant.email);
		expect(mailbox.sent[0].html).toContain("/activate?token=");
	});

	test("approving again re-sends the email", async () => {
		const { cookie } = await superSession();
		const tenant = await createTenant({ status: "AWAITING_ACTIVATION" });

		await call("POST", "/api/v1/superadmin/approve", { cookie, body: { email: tenant.email } });

		expect(mailbox.sent).toHaveLength(1);
	});

	test("returns 502 when the email fails, leaving the tenant retryable", async () => {
		const { cookie } = await superSession();
		const tenant = await createTenant({ status: "PENDING" });
		mailbox.shouldFail = true;

		const res = await call("POST", "/api/v1/superadmin/approve", {
			cookie,
			body: { email: tenant.email },
		});

		expect(res.status).toBe(502);
		expect(await statusOf(tenant.id)).toBe("AWAITING_ACTIVATION");
	});

	test("does not re-approve ACTIVE or REJECTED tenants", async () => {
		const { cookie } = await superSession();
		for (const status of ["ACTIVE", "REJECTED"]) {
			const tenant = await createTenant({ status });
			const res = await call("POST", "/api/v1/superadmin/approve", {
				cookie,
				body: { email: tenant.email },
			});
			expect(res.status).toBe(404);
			expect(await statusOf(tenant.id)).toBe(status);
		}
		expect(mailbox.sent).toHaveLength(0);
	});
});

describe("reject", () => {
	test("rejects a PENDING tenant", async () => {
		const { cookie } = await superSession();
		const tenant = await createTenant({ status: "PENDING" });

		const res = await call("POST", "/api/v1/superadmin/reject", {
			cookie,
			body: { email: tenant.email },
		});

		expect(res.status).toBe(200);
		expect(await statusOf(tenant.id)).toBe("REJECTED");
	});

	test("cannot reject an ACTIVE tenant", async () => {
		const { cookie } = await superSession();
		const tenant = await createTenant({ status: "ACTIVE" });

		const res = await call("POST", "/api/v1/superadmin/reject", {
			cookie,
			body: { email: tenant.email },
		});

		expect(res.status).toBe(404);
		expect(await statusOf(tenant.id)).toBe("ACTIVE");
	});
});

describe("souls", () => {
	test("lists non-pending tenants with their event counts", async () => {
		const { cookie } = await superSession();
		const tenant = await createTenant({ status: "ACTIVE" });
		await createEvent(tenant.id);
		await createEvent(tenant.id);
		await createTenant({ status: "PENDING" });

		const souls = await (await call("GET", "/api/v1/superadmin/souls", { cookie })).json();

		expect(souls).toEqual([
			{
				id: tenant.id,
				name: tenant.name,
				email: tenant.email,
				status: "ACTIVE",
				conjurations: 2,
			},
		]);
	});

	test("deleting a tenant cascades to events and attendees", async () => {
		const { cookie } = await superSession();
		const tenant = await createTenant();
		const event = await createEvent(tenant.id);
		await createAttendee(event.id);

		const res = await call("DELETE", `/api/v1/superadmin/souls/${tenant.id}`, { cookie });

		expect(res.status).toBe(200);
		expect(await testDb.query.tenants.findMany()).toHaveLength(0);
		expect(await testDb.query.events.findMany()).toHaveLength(0);
		expect(await testDb.query.attendees.findMany()).toHaveLength(0);
	});

	test("404 for an unknown tenant", async () => {
		const { cookie } = await superSession();
		const res = await call("DELETE", `/api/v1/superadmin/souls/${MISSING_UUID}`, { cookie });
		expect(res.status).toBe(404);
	});
});
