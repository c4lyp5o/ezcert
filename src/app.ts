import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";

import { logger } from "./logger";
import registrationModule from "./modules/register";
import authModule from "./modules/auth";
import adminModule from "./modules/admin";
import designsModule from "./modules/designs";
import superadminsModule from "./modules/superadmin";
import publicModule from "./modules/public";

// Expected client-side failures; logged quietly rather than as server errors
const CLIENT_ERROR_CODES = new Set(["VALIDATION", "NOT_FOUND", "PARSE"]);

// Built separately from index.ts so tests can call app.handle() without listening
export const app = new Elysia()
	// Restrict credentialed cross-origin requests to our own domain when configured
	.use(cors({ origin: process.env.DOMAIN_NAME || true }))
	.derive({ as: "global" }, () => ({ startedAt: performance.now() }))
	.onAfterResponse({ as: "global" }, ({ request, set, startedAt }) => {
		// Path only: query strings and bodies may carry tokens or passwords
		const { pathname } = new URL(request.url);
		const ms = (performance.now() - (startedAt ?? performance.now())).toFixed(1);
		logger.info(`${request.method} ${pathname} ${set.status ?? 200} ${ms}ms`);
	})
	.onError({ as: "global" }, ({ code, error, request }) => {
		const { pathname } = new URL(request.url);
		if (CLIENT_ERROR_CODES.has(String(code))) {
			logger.debug(`${code} on ${request.method} ${pathname}`);
			return;
		}
		logger.error(`Unhandled ${code} on ${request.method} ${pathname}`, error);
	})
	.use(registrationModule)
	.use(authModule)
	.use(adminModule)
	.use(designsModule)
	.use(superadminsModule)
	.use(publicModule);
