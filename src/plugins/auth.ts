import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";

const isProduction = process.env.NODE_ENV === "production";

const secret = (key: string, devFallback: string) => {
	const value = process.env[key];
	if (value) return value;
	if (isProduction) throw new Error(`${key} must be set in production`);
	return devFallback;
};

export const cookieOptions = {
	httpOnly: true,
	secure: isProduction,
	sameSite: "lax",
	path: "/",
} as const;

// Shared JWT decorators + auth macros. Named so Elysia dedupes it across modules.
export const authPlugin = new Elysia({ name: "auth" })
	.use(
		jwt({
			name: "jwtTenant",
			secret: secret("JWT_SECRET", "tenant-secret"),
			exp: "7d",
		}),
	)
	.use(
		jwt({
			name: "jwtSuper",
			secret: secret("SUPER_JWT_SECRET", "super-secret"),
			exp: "1h",
		}),
	)
	.use(
		jwt({
			name: "jwtMagic",
			secret: secret("MAGIC_JWT_SECRET", "magic-secret"),
			exp: "1h",
		}),
	)
	.macro({
		adminAuth: {
			async resolve({ jwtTenant, cookie: { admin_token }, status }) {
				const token = admin_token.value;
				if (typeof token !== "string" || !token)
					return status(401, "No cookie found");

				const profile = await jwtTenant.verify(token);
				if (!profile || typeof profile.tenantId !== "string")
					return status(401, "Invalid token");
				return { user: { tenantId: profile.tenantId } };
			},
		},
		superAuth: {
			async resolve({ jwtSuper, cookie: { super_token }, status }) {
				const token = super_token.value;
				if (typeof token !== "string" || !token)
					return status(401, "No cookie found");

				const profile = await jwtSuper.verify(token);
				if (
					!profile ||
					profile.role !== "superadmin" ||
					typeof profile.id !== "string"
				)
					return status(401, "Invalid token");
				return { user: { id: profile.id } };
			},
		},
	});
