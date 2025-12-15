// server/src/db/schema.ts
import {
	bigint,
	pgTable,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const superAdmins = pgTable("super_admins", {
	id: uuid("id").defaultRandom().primaryKey(),
	username: text("username").notNull().unique(),
	password: text("password").notNull(),
	createdAt: timestamp("created_at").defaultNow(),
});

export const tenants = pgTable("tenants", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	password: text("password").notNull(),
	status: text("status").default("PENDING"), // PENDING | APPROVED | REJECTED
	createdAt: timestamp("created_at").defaultNow(),
});

export const events = pgTable("events", {
	id: uuid("id").defaultRandom().primaryKey(),
	tenantId: uuid("tenant_id").references(() => tenants.id, {
		onDelete: "cascade",
	}),
	name: text("name").notNull(),
	date: timestamp("date").notNull(),
	location: text("location").notNull(),
	template: text("template").notNull().default("default"),
});

export const attendees = pgTable("attendees", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull(),
	eventId: uuid("event_id").references(() => events.id, {
		onDelete: "cascade",
	}),
	createdAt: timestamp("created_at").defaultNow(),
});

// Define relations for simpler querying
export const companiesRelations = relations(tenants, ({ many }) => ({
	events: many(events),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
	company: one(tenants, {
		fields: [events.tenantId],
		references: [tenants.id],
	}),
	attendees: many(attendees),
}));

export const attendeesRelations = relations(attendees, ({ one }) => ({
	event: one(events, {
		fields: [attendees.eventId],
		references: [events.id],
	}),
}));
