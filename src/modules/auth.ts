import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { superAdmins, tenants } from "../db/schema";
import { authPlugin, cookieOptions } from "../plugins/auth";
import { logger, maskEmail } from "../logger";

const TENANT_SESSION_SECONDS = 7 * 24 * 60 * 60;
const SUPER_SESSION_SECONDS = 60 * 60;

const authModule = new Elysia({ prefix: "/api/v1/auth" })
	.use(authPlugin)
	.post(
		"/activate",
		async ({ jwtMagic, body }) => {
			const decoded = await jwtMagic.verify(body.token);
			if (!decoded || typeof decoded.tenantId !== "string") {
				logger.warn("Activation attempted with invalid or expired token");
				return { success: false, message: "Invalid or expired token" };
			}
			const tenantId = decoded.tenantId;

			const tenant = await db.query.tenants.findFirst({
				where: eq(tenants.id, tenantId),
				columns: { status: true },
			});
			if (!tenant) return { success: false, message: "Invalid token" };
			if (tenant.status === "ACTIVE") {
				return { success: true, message: "Already active" };
			}

			// Conditional update guards against a concurrent reject/delete
			const updated = await db
				.update(tenants)
				.set({ status: "ACTIVE" })
				.where(
					and(eq(tenants.id, tenantId), eq(tenants.status, "AWAITING_ACTIVATION")),
				)
				.returning({ id: tenants.id });
			if (updated.length === 0) {
				logger.warn(`Activation refused for tenant ${tenantId} in state ${tenant.status}`);
				return { success: false, message: "Invalid request state" };
			}

			logger.success(`Tenant activated: ${tenantId}`);
			return { success: true };
		},
		{
			body: t.Object({ token: t.String() }),
		},
	)
	.post(
		"/admin/login",
		async ({ jwtTenant, body, cookie: { admin_token } }) => {
			const tenant = await db.query.tenants.findFirst({
				where: eq(tenants.email, body.email),
			});

			// Verify the password before revealing account state
			const isMatch =
				!!tenant && (await Bun.password.verify(body.password, tenant.password));
			if (!tenant || !isMatch) {
				logger.warn(`Failed tenant login for ${maskEmail(body.email)}`);
				return { success: false, message: "Invalid credentials" };
			}

			if (tenant.status !== "ACTIVE") {
				logger.warn(`Login blocked for tenant ${tenant.id}: status ${tenant.status}`);
				return {
					success: false,
					message:
						tenant.status === "AWAITING_ACTIVATION"
							? "Account not active. Please check your email for the activation link."
							: "Account is pending review or was not approved.",
				};
			}

			const token = await jwtTenant.sign({
				tenantId: tenant.id,
				email: tenant.email,
			});
			admin_token.set({
				...cookieOptions,
				value: token,
				maxAge: TENANT_SESSION_SECONDS,
			});

			logger.info(`Tenant logged in: ${tenant.id}`);
			return { success: true, message: "Login successful" };
		},
		{
			body: t.Object({ email: t.String(), password: t.String() }),
		},
	)
	.post("/admin/logout", ({ cookie: { admin_token } }) => {
		admin_token.set({ ...cookieOptions, value: "", maxAge: 0 });
		return { success: true };
	})
	.get(
		"/admin/me",
		async ({ user }) => {
			const tenant = await db.query.tenants.findFirst({
				where: eq(tenants.id, user.tenantId),
				columns: { id: true, name: true, email: true },
			});
			return { user: tenant ?? null };
		},
		{ adminAuth: true },
	)
	.post(
		"/super/login",
		async ({ jwtSuper, body, cookie: { super_token } }) => {
			const admin = await db.query.superAdmins.findFirst({
				where: eq(superAdmins.username, body.username),
			});

			// Same response for unknown user and wrong password (no user enumeration)
			const isMatch =
				!!admin && (await Bun.password.verify(body.password, admin.password));
			if (!admin || !isMatch) {
				logger.warn(`Failed superadmin login for username "${body.username}"`);
				return { success: false, message: "The void does not answer" };
			}

			const token = await jwtSuper.sign({
				id: admin.id,
				role: "superadmin",
			});
			super_token.set({
				...cookieOptions,
				value: token,
				maxAge: SUPER_SESSION_SECONDS,
			});

			logger.info(`Superadmin logged in: ${admin.username}`);
			return { success: true };
		},
		{
			body: t.Object({ username: t.String(), password: t.String() }),
		},
	)
	.post("/super/logout", ({ cookie: { super_token } }) => {
		super_token.set({ ...cookieOptions, value: "", maxAge: 0 });
		return { success: true };
	})
	.get(
		"/super/me",
		async ({ user, status }) => {
			// Never return the password hash
			const superadmin = await db.query.superAdmins.findFirst({
				where: eq(superAdmins.id, user.id),
				columns: { id: true, username: true },
			});
			if (!superadmin) return status(401, "Unknown superadmin");

			return { success: true, user: superadmin };
		},
		{ superAuth: true },
	);

export default authModule;
