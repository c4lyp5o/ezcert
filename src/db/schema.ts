// server/src/db/schema.ts
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import type { Layout } from "../designs/layout";

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
	status: text("status").default("PENDING"), // PENDING | AWAITING_ACTIVATION | ACTIVE | REJECTED
	createdAt: timestamp("created_at").defaultNow(),
});

// Uploaded, server-sanitised images (logos, backgrounds, signatures)
export const assets = pgTable(
	"assets",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		tenantId: uuid("tenant_id")
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(), // logo | background | signature | image
		mime: text("mime").notNull(),
		size: integer("size").notNull(),
		width: integer("width").notNull(),
		height: integer("height").notNull(),
		storageKey: text("storage_key").notNull(),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => [index("assets_tenant_idx").on(table.tenantId)],
);

// Tenant-built certificate layouts (see src/designs/layout.ts)
export const designs = pgTable(
	"designs",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		tenantId: uuid("tenant_id")
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		layout: jsonb("layout").$type<Layout>().notNull(),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => [index("designs_tenant_idx").on(table.tenantId)],
);

export const events = pgTable("events", {
	id: uuid("id").defaultRandom().primaryKey(),
	tenantId: uuid("tenant_id").references(() => tenants.id, {
		onDelete: "cascade",
	}),
	name: text("name").notNull(),
	date: timestamp("date").notNull(),
	location: text("location").notNull(),
	template: text("template").notNull().default("default"),
	// When set, overrides the built-in template
	designId: uuid("design_id").references(() => designs.id, {
		onDelete: "set null",
	}),
	isOpen: boolean("is_open").default(false),
	// Ask attendees for their IC number (needed for CPD verification); off by default
	collectIc: boolean("collect_ic").notNull().default(false),
});

// name and email hold AES-GCM ciphertext ("enc:v1:..."); always read/write via src/crypto/pii.ts
export const attendees = pgTable(
	"attendees",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull(),
		// Keyed HMAC of the normalised email: finds repeat check-ins without decrypting
		emailHash: text("email_hash"),
		// Encrypted MyKad number; only set for events with collect_ic. Never logged or shown in full.
		ic: text("ic"),
		eventId: uuid("event_id").references(() => events.id, {
			onDelete: "cascade",
		}),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => [index("attendees_event_email_idx").on(table.eventId, table.emailHash)],
);

// Define relations for simpler querying
export const companiesRelations = relations(tenants, ({ many }) => ({
	events: many(events),
	designs: many(designs),
	assets: many(assets),
}));

export const designsRelations = relations(designs, ({ one }) => ({
	tenant: one(tenants, {
		fields: [designs.tenantId],
		references: [tenants.id],
	}),
}));

export const assetsRelations = relations(assets, ({ one }) => ({
	tenant: one(tenants, {
		fields: [assets.tenantId],
		references: [tenants.id],
	}),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
	company: one(tenants, {
		fields: [events.tenantId],
		references: [tenants.id],
	}),
	design: one(designs, {
		fields: [events.designId],
		references: [designs.id],
	}),
	attendees: many(attendees),
}));

export const attendeesRelations = relations(attendees, ({ one }) => ({
	event: one(events, {
		fields: [attendees.eventId],
		references: [events.id],
	}),
}));
