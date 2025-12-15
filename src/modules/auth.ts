import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { superAdmins, tenants } from "../db/schema";

const authModule = new Elysia({ prefix: "/api/v1/auth" })
	.macro({
		adminAuth: (enabled: true) => ({
			resolve: async ({ jwtTenant, cookie: { admin_token }, status }) => {
				console.log("Tenant JWT Auth Macro Invoked");
				const token = admin_token.value;
				if (!token) return status(401, "No cookie found");

				const profile = await jwtTenant.verify(token);
				if (!profile) return status(401, "Invalid token");
				// console.log("Verified tenant profile:", profile);
				return { user: profile };
			},
		}),
		superAuth: (enabled: true) => ({
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
	// .post(
	// 	"/verify",
	// 	async ({ body }) => {
	// 		// In our simple example, the token is "magic-" + UUID
	// 		// In production, verify a JWT here
	// 		const prefix = "magic-";

	// 		if (!body.token.startsWith(prefix)) {
	// 			return { success: false, message: "Invalid token format" };
	// 		}

	// 		const tenantId = body.token.slice(prefix.length);

	// 		const result = await db
	// 			.select()
	// 			.from(tenants)
	// 			.where(eq(tenants.id, tenantId));

	// 		if (result.length === 0) {
	// 			return { success: false, message: "User not found" };
	// 		}

	// 		const tenant = result[0];

	// 		if (tenant.status !== "APPROVED") {
	// 			return { success: false, message: "Account not approved yet" };
	// 		}

	// 		return {
	// 			success: true,
	// 			tenant: {
	// 				id: tenant.id,
	// 				name: tenant.name,
	// 				email: tenant.email,
	// 			},
	// 		};
	// 	},
	// 	{
	// 		body: t.Object({ token: t.String() }),
	// 	},
	// )
	.post(
		"/activate",
		async ({ jwtMagic, body }) => {
			let tenantId: string;

			try {
				const decoded = await jwtMagic.verify(body.token);
				if (!decoded || !decoded.tenantId) {
					return { success: false, message: "Invalid token" };
				}
				tenantId = decoded.tenantId;
			} catch (err) {
				console.error("Error verifying magic token:", err);
				return { success: false, message: "Invalid or expired token" };
			}

			const result = await db
				.select()
				.from(tenants)
				.where(eq(tenants.id, tenantId));
			if (result.length === 0) {
				return { success: false, message: "Invalid token" };
			}

			const tenant = result[0];

			if (tenant.status === "ACTIVE") {
				return { success: true, message: "Already active" };
			}
			if (tenant.status !== "AWAITING_ACTIVATION") {
				return { success: false, message: "Invalid request state" };
			}

			await db
				.update(tenants)
				.set({ status: "ACTIVE" })
				.where(eq(tenants.id, tenantId));

			return { success: true };
		},
		{
			body: t.Object({ token: t.String() }),
		},
	)
	.post(
		"/admin/login",
		async ({ jwtTenant, body, cookie: { admin_token } }) => {
			console.log("Login attempt for:", body.email);
			const result = await db
				.select()
				.from(tenants)
				.where(eq(tenants.email, body.email));

			if (result.length === 0)
				return { success: false, message: "Invalid credentials" };

			const tenant = result[0];

			if (tenant.status !== "ACTIVE") {
				return {
					success: false,
					message:
						"Account not active. Please check your email for the activation link.",
				};
			}

			const isMatch = await Bun.password.verify(body.password, tenant.password);
			if (!isMatch) return { success: false, message: "Invalid credentials" };

			const token = await jwtTenant.sign({
				tenantId: tenant.id,
				email: tenant.email,
			});
			admin_token.set({
				value: token,
				httpOnly: true,
				secure: process.env.NODE_ENV === "production",
				sameSite: "lax",
				path: "/",
				maxAge: 7 * 24 * 60 * 60, // 7 days
			});

			return {
				success: true,
				// tenant: { id: tenant.id, name: tenant.name, email: tenant.email },
				message: "Login successful",
			};
		},
		{
			body: t.Object({ email: t.String(), password: t.String() }),
		},
	)
	.post("/admin/logout", async ({ cookie: { admin_token } }) => {
		admin_token.set({
			value: "",
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 0, // Expire immediately
		});
		return { success: true };
	})
	.get(
		"/admin/me",
		async ({ user }) => {
			const tenant = await db.query.tenants.findFirst({
				where: eq(tenants.id, user.tenantId),
			});
			if (!tenant) return { user: null };

			return { user: { id: tenant.id, name: tenant.name } };
		},
		{ adminAuth: true },
	)
	.post(
		"/super/login",
		async ({ jwtSuper, body, cookie: { super_token } }) => {
			const result = await db
				.select()
				.from(superAdmins)
				.where(eq(superAdmins.username, body.username));

			if (result.length === 0) {
				return { success: false, message: "Unknown entity" };
			}

			const admin = result[0];

			const isMatch = await Bun.password.verify(body.password, admin.password);
			if (!isMatch) {
				return { success: false, message: "Incorrect word" };
			}

			const token = await jwtSuper.sign({
				id: admin.id,
				role: "superadmin",
			});
			super_token.set({
				value: token,
				httpOnly: true,
				secure: process.env.NODE_ENV === "production",
				sameSite: "lax",
				path: "/",
				maxAge: 1 * 60 * 60, // 1 hour
			});

			return { success: true };
		},
		{
			body: t.Object({ username: t.String(), password: t.String() }),
		},
	)
	.post("/super/logout", async ({ cookie: { super_token } }) => {
		super_token.set({
			value: "",
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 0, // Expire immediately
		});
		return { success: true };
	})
	.get(
		"/super/me",
		async ({ user }) => {
			return { success: true, user };
		},
		{ superAuth: true },
	);

export default authModule;
