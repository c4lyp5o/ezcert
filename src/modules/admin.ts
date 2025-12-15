import { Elysia, t } from "elysia";
import { desc, eq } from "drizzle-orm";

import { db } from "../db";
import { events } from "../db/schema";
import { validateUUID } from "../utils";

const adminModule = new Elysia({ prefix: "/api/v1/admin" })
	.guard({
		beforeHandle: async ({ jwtTenant, cookie: { admin_token }, status }) => {
			console.log("Admin JWT Auth Guard Invoked");
			const token = admin_token.value;
			if (!token) return status(401, "No cookie found");

			const profile = await jwtTenant.verify(token);
			if (!profile) return status(401, "Invalid token");
			// console.log("Verified tenant profile:", profile);
			return { user: profile };
		},
	})
	.get("/events", async ({ user, status }) => {
		try {
			if (!validateUUID(user.tenantId)) return status(400, "Invalid ID format");

			const result = await db.query.events.findMany({
				where: eq(events.tenantId, user.tenantId),
				orderBy: [desc(events.date)],
				with: {
					attendees: true,
				},
			});

			return result;
		} catch (error) {
			console.error("Error fetching events for tenant:", error);
			return [];
		}
	})
	.post(
		"/events",
		async ({ body }) => {
			const result = await db
				.insert(events)
				.values({
					tenantId: body.tenantId,
					name: body.name,
					date: new Date(body.date),
					location: body.location,
					template: body.template,
				})
				.returning({
					id: events.id,
					tenantId: events.tenantId,
					name: events.name,
					date: events.date,
					location: events.location,
					template: events.template,
				});

			return result[0];
		},
		{
			body: t.Object({
				tenantId: t.String(),
				name: t.String(),
				date: t.String(),
				location: t.String(),
				template: t.String(),
			}),
		},
	);

export default adminModule;
