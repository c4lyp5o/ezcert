import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { tenants } from "../src/db/schema";
import { mailbox, testDb } from "./setup";
import {
	PASSWORD,
	call,
	cookieFrom,
	createTenant,
	superSession,
	tenantSession,
} from "./helpers";

const register = (body: Record<string, string>) =>
	call("POST", "/api/v1/register", { body });

describe("registration", () => {
	test("creates a PENDING tenant with a hashed password", async () => {
		const res = await register({
			tenantName: "Klinik Kesihatan",
			email: "kk@example.com",
			password: PASSWORD,
		});

		expect(await res.json()).toMatchObject({ success: true });
		const tenant = await testDb.query.tenants.findFirst({
			where: eq(tenants.email, "kk@example.com"),
		});
		expect(tenant?.status).toBe("PENDING");
		expect(tenant?.password).not.toBe(PASSWORD);
	});

	test("refuses a duplicate email", async () => {
		const existing = await createTenant();
		const res = await register({
			tenantName: "Dupe",
			email: existing.email,
			password: PASSWORD,
		});
		expect(await res.json()).toMatchObject({
			success: false,
			message: "Email already registered",
		});
	});

	test.each([
		["invalid email", { tenantName: "A", email: "nope", password: PASSWORD }],
		["short password", { tenantName: "A", email: "a@b.co", password: "short" }],
		["empty name", { tenantName: "", email: "a@b.co", password: PASSWORD }],
	])("rejects %s with 422", async (_label, body) => {
		expect((await register(body)).status).toBe(422);
	});
});

describe("tenant login", () => {
	test("sets an httpOnly admin_token cookie for an ACTIVE tenant", async () => {
		const tenant = await createTenant();
		const res = await call("POST", "/api/v1/auth/admin/login", {
			body: { email: tenant.email, password: PASSWORD },
		});

		expect(await res.json()).toMatchObject({ success: true });
		expect(res.headers.getSetCookie().join()).toContain("HttpOnly");
		expect(cookieFrom(res, "admin_token")).not.toBeNull();
	});

	test("returns the same message for unknown email and wrong password", async () => {
		const tenant = await createTenant();
		const wrongPassword = await call("POST", "/api/v1/auth/admin/login", {
			body: { email: tenant.email, password: "wrong-password" },
		});
		const unknownEmail = await call("POST", "/api/v1/auth/admin/login", {
			body: { email: "ghost@example.com", password: PASSWORD },
		});

		const expected = { success: false, message: "Invalid credentials" };
		expect(await wrongPassword.json()).toEqual(expected);
		expect(await unknownEmail.json()).toEqual(expected);
	});

	test("blocks tenants that are not ACTIVE", async () => {
		const tenant = await createTenant({ status: "PENDING" });
		const res = await call("POST", "/api/v1/auth/admin/login", {
			body: { email: tenant.email, password: PASSWORD },
		});

		expect(await res.json()).toMatchObject({ success: false });
		expect(cookieFrom(res, "admin_token")).toBeNull();
	});

	test("/admin/me returns the profile without the password hash", async () => {
		const { tenant, cookie } = await tenantSession();
		const res = await call("GET", "/api/v1/auth/admin/me", { cookie });

		expect(await res.json()).toEqual({
			user: { id: tenant.id, name: tenant.name, email: tenant.email },
		});
	});

	test("/admin/me rejects missing and forged tokens", async () => {
		expect((await call("GET", "/api/v1/auth/admin/me")).status).toBe(401);
		const forged = await call("GET", "/api/v1/auth/admin/me", {
			cookie: "admin_token=not.a.jwt",
		});
		expect(forged.status).toBe(401);
	});

	test("logout expires the cookie", async () => {
		const res = await call("POST", "/api/v1/auth/admin/logout");
		const header = res.headers.getSetCookie().find((c) => c.startsWith("admin_token="));
		expect(header).toContain("Max-Age=0");
	});
});

describe("superadmin login", () => {
	test("/super/me never exposes the password hash", async () => {
		const { admin, cookie } = await superSession();
		const body = await (await call("GET", "/api/v1/auth/super/me", { cookie })).json();

		expect(body).toEqual({
			success: true,
			user: { id: admin.id, username: admin.username },
		});
	});

	test("does not reveal whether the username exists", async () => {
		await superSession("oracle");
		const wrongPassword = await call("POST", "/api/v1/auth/super/login", {
			body: { username: "oracle", password: "nope" },
		});
		const unknownUser = await call("POST", "/api/v1/auth/super/login", {
			body: { username: "nobody", password: "nope" },
		});

		expect(await wrongPassword.json()).toEqual(await unknownUser.json());
	});

	test("a tenant token cannot be used as a superadmin token", async () => {
		const { cookie } = await tenantSession();
		const asSuper = cookie.replace("admin_token=", "super_token=");
		expect((await call("GET", "/api/v1/auth/super/me", { cookie: asSuper })).status).toBe(401);
	});
});

describe("approval → activation → login flow", () => {
	test("an approved tenant can activate via the emailed link and log in", async () => {
		const { cookie: superCookie } = await superSession();
		const tenant = await createTenant({ status: "PENDING" });

		const approve = await call("POST", "/api/v1/superadmin/approve", {
			cookie: superCookie,
			body: { email: tenant.email },
		});
		expect(approve.status).toBe(200);
		expect(mailbox.sent).toHaveLength(1);

		const token = mailbox.sent[0].html.match(/activate\?token=([^"&\s]+)/)?.[1];
		expect(token).toBeDefined();

		const activate = await call("POST", "/api/v1/auth/activate", { body: { token } });
		expect(await activate.json()).toEqual({ success: true });

		// Second click on the same link is harmless
		const again = await call("POST", "/api/v1/auth/activate", { body: { token } });
		expect(await again.json()).toMatchObject({ success: true, message: "Already active" });

		const login = await call("POST", "/api/v1/auth/admin/login", {
			body: { email: tenant.email, password: PASSWORD },
		});
		expect(await login.json()).toMatchObject({ success: true });
	});

	test("rejects a bogus activation token", async () => {
		const res = await call("POST", "/api/v1/auth/activate", {
			body: { token: "garbage" },
		});
		expect(await res.json()).toMatchObject({ success: false });
	});

	test("a REJECTED tenant cannot activate with an old token", async () => {
		const { cookie } = await superSession();
		const tenant = await createTenant({ status: "PENDING" });
		await call("POST", "/api/v1/superadmin/approve", {
			cookie,
			body: { email: tenant.email },
		});
		const token = mailbox.sent[0].html.match(/activate\?token=([^"&\s]+)/)?.[1];
		await testDb.update(tenants).set({ status: "REJECTED" }).where(eq(tenants.id, tenant.id));

		const res = await call("POST", "/api/v1/auth/activate", { body: { token } });
		expect(await res.json()).toMatchObject({ success: false });
	});
});
