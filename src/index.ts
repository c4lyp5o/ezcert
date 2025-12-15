// server/src/index.ts
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";

import registrationModule from "./modules/register";
import authModule from "./modules/auth";
import adminModule from "./modules/admin";
import superadminsModule from "./modules/superadmin";
import publicModule from "./modules/public";

const PORT = process.env.PORT || 5000;

const app = new Elysia();

app
	.use(cors())
	.use(
		jwt({
			name: "jwtTenant",
			secret: process.env.JWT_SECRET || "tenant-secret",
			exp: "7d",
		}),
	)
	.use(
		jwt({
			name: "jwtSuper",
			secret: process.env.SUPER_JWT_SECRET || "super-secret",
			exp: "2h",
		}),
	)
	.use(
		jwt({
			name: "jwtMagic",
			secret: process.env.MAGIC_JWT_SECRET || "magic-secret",
			exp: "1h",
		}),
	)
	.use(registrationModule)
	.use(authModule)
	.use(adminModule)
	.use(superadminsModule)
	.use(publicModule)
	.listen(PORT);

console.log(`🦊 Backend running at ${app.server?.url}`);
