import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { events } from "../src/db/schema";
import { MAX_ELEMENTS } from "../src/designs/layout";
import { testDb } from "./setup";
import {
	MISSING_UUID,
	call,
	createAttendee,
	createEvent,
	layoutWith,
	pdfHasImage,
	pdfPageCount,
	pdfPageSize,
	tenantSession,
	textElement,
	uploadAsset,
} from "./helpers";

const DESIGNS = "/api/v1/admin/designs";

const createDesign = async (cookie: string, layout = layoutWith(), name = "Gala") => {
	const res = await call("POST", DESIGNS, { cookie, body: { name, layout } });
	return { res, design: res.status === 200 ? await res.json() : null };
};

describe("design CRUD", () => {
	test("requires a tenant session", async () => {
		expect((await call("GET", DESIGNS)).status).toBe(401);
		expect((await call("POST", DESIGNS, { body: { name: "x", layout: layoutWith() } })).status).toBe(401);
	});

	test("creates, reads, updates and lists a design", async () => {
		const { cookie } = await tenantSession();
		const { design } = await createDesign(cookie);

		const fetched = await (await call("GET", `${DESIGNS}/${design.id}`, { cookie })).json();
		expect(fetched.layout.elements[0].text).toBe("{{attendee_name}}");
		expect(fetched).not.toHaveProperty("tenantId");

		const updated = await call("PUT", `${DESIGNS}/${design.id}`, {
			cookie,
			body: { name: "Renamed", layout: layoutWith([textElement("Hello {{event_name}}")]) },
		});
		expect(await updated.json()).toMatchObject({ id: design.id, name: "Renamed" });

		const list = await (await call("GET", DESIGNS, { cookie })).json();
		expect(list.map((d: { name: string }) => d.name)).toEqual(["Renamed"]);
	});

	test.each([
		["text outside the page", layoutWith([textElement("x", { x: 5000 })])],
		["invalid colour", layoutWith([textElement("x", { color: "red" })])],
		["unknown font", layoutWith([textElement("x", { font: "Comic Sans" })])],
		["empty text", layoutWith([textElement("")])],
		["unknown element type", layoutWith([{ type: "script", src: "x" }])],
		["too many elements", layoutWith(Array.from({ length: MAX_ELEMENTS + 1 }, () => textElement()))],
	])("rejects %s with 422", async (_label, layout) => {
		const { cookie } = await tenantSession();
		const { res } = await createDesign(cookie, layout as ReturnType<typeof layoutWith>);
		expect(res.status).toBe(422);
	});

	test("cannot reference another tenant's images", async () => {
		const owner = await tenantSession();
		const intruder = await tenantSession();
		const asset = await uploadAsset(owner.cookie);

		const asBackground = await createDesign(intruder.cookie, layoutWith([], asset.id));
		const asImage = await createDesign(
			intruder.cookie,
			layoutWith([{ type: "image", assetId: asset.id, x: 10, y: 10, width: 50, height: 50 }]),
		);
		expect(asBackground.res.status).toBe(422);
		expect(asImage.res.status).toBe(422);
	});

	test("another tenant cannot read, update or delete it", async () => {
		const owner = await tenantSession();
		const intruder = await tenantSession();
		const { design } = await createDesign(owner.cookie);
		const path = `${DESIGNS}/${design.id}`;

		expect((await call("GET", path, { cookie: intruder.cookie })).status).toBe(404);
		expect(
			(await call("PUT", path, { cookie: intruder.cookie, body: { name: "x", layout: layoutWith() } })).status,
		).toBe(404);
		expect((await call("DELETE", path, { cookie: intruder.cookie })).status).toBe(404);
		expect((await call("GET", `${DESIGNS}/${MISSING_UUID}`, { cookie: owner.cookie })).status).toBe(404);
	});

	test("deleting a design reverts its events to the built-in template", async () => {
		const { tenant, cookie } = await tenantSession();
		const { design } = await createDesign(cookie);
		const event = await createEvent(tenant.id, { designId: design.id });

		await call("DELETE", `${DESIGNS}/${design.id}`, { cookie });

		const after = await testDb.query.events.findFirst({ where: eq(events.id, event.id) });
		expect(after?.designId).toBeNull();
	});
});

describe("preview", () => {
	test("renders a one-page PDF with sample data", async () => {
		const { cookie } = await tenantSession();
		const asset = await uploadAsset(cookie);
		const res = await call("POST", `${DESIGNS}/preview`, {
			cookie,
			body: {
				layout: layoutWith(
					[
						textElement(),
						{ type: "image", assetId: asset.id, x: 20, y: 20, width: 80, height: 40 },
						{ type: "qr", x: 700, y: 450, size: 100, color: "#000000" },
					],
					null,
				),
			},
		});
		const pdf = new Uint8Array(await res.arrayBuffer());

		expect(res.headers.get("content-type")).toBe("application/pdf");
		expect(pdfPageCount(pdf)).toBe(1);
		expect(pdfHasImage(pdf)).toBe(true);
	});
});

describe("events using designs", () => {
	test("attaching a design at creation and via the certificate endpoint", async () => {
		const { cookie } = await tenantSession();
		const { design } = await createDesign(cookie);

		const created = await (
			await call("POST", "/api/v1/admin/events", {
				cookie,
				body: {
					name: "Gala",
					date: "2026-12-01T10:00:00.000Z",
					location: "KL",
					template: "default",
					designId: design.id,
				},
			})
		).json();
		expect(created.designId).toBe(design.id);

		const cleared = await call("PATCH", `/api/v1/admin/events/${created.id}/certificate`, {
			cookie,
			body: { template: "tech-dark", designId: null },
		});
		expect(await cleared.json()).toEqual({ id: created.id, template: "tech-dark", designId: null });
	});

	test("cannot attach another tenant's design", async () => {
		const owner = await tenantSession();
		const intruder = await tenantSession();
		const { design } = await createDesign(owner.cookie);
		const event = await createEvent(intruder.tenant.id);

		const res = await call("PATCH", `/api/v1/admin/events/${event.id}/certificate`, {
			cookie: intruder.cookie,
			body: { template: "default", designId: design.id },
		});
		expect(res.status).toBe(422);
	});

	test("certificates use the attached design (with its images)", async () => {
		const { tenant, cookie } = await tenantSession();
		const asset = await uploadAsset(cookie);
		const { design } = await createDesign(
			cookie,
			layoutWith([textElement(), { type: "image", assetId: asset.id, x: 20, y: 20, width: 80, height: 40 }]),
		);
		const withDesign = await createAttendee((await createEvent(tenant.id, { designId: design.id })).id);
		const builtIn = await createAttendee((await createEvent(tenant.id)).id);

		const designed = new Uint8Array(
			await (await call("GET", `/api/v1/events/certificate/${withDesign.id}`)).arrayBuffer(),
		);
		const plain = new Uint8Array(
			await (await call("GET", `/api/v1/events/certificate/${builtIn.id}`)).arrayBuffer(),
		);

		expect(pdfPageCount(designed)).toBe(1);
		expect(pdfHasImage(designed)).toBe(true);
		expect(pdfPageCount(plain)).toBe(1);
		expect(pdfHasImage(plain)).toBe(false);
	});

	test("a deleted image file doesn't break certificate downloads", async () => {
		const { tenant, cookie } = await tenantSession();
		const asset = await uploadAsset(cookie);
		const { design } = await createDesign(cookie, layoutWith([textElement()], asset.id));
		const attendee = await createAttendee((await createEvent(tenant.id, { designId: design.id })).id);

		// Simulate the file vanishing from disk (e.g. lost volume)
		const { storage } = await import("../src/storage");
		const row = await testDb.query.assets.findFirst();
		await storage.remove(row!.storageKey);

		const res = await call("GET", `/api/v1/events/certificate/${attendee.id}`);
		expect(res.status).toBe(200);
		expect(pdfPageCount(new Uint8Array(await res.arrayBuffer()))).toBe(1);
	});
});

describe("portrait designs", () => {
	const portrait = (elements: unknown[]) => ({ ...layoutWith(elements), orientation: "portrait" });
	const tall = textElement("{{attendee_name}}", { x: 40, y: 700, width: 515 });

	test("bounds depend on orientation: y=700 fits portrait but not landscape", async () => {
		const { cookie } = await tenantSession();
		const asLandscape = await createDesign(cookie, layoutWith([tall]));
		const asPortrait = await createDesign(cookie, portrait([tall]) as ReturnType<typeof layoutWith>);

		expect(asLandscape.res.status).toBe(422);
		expect(await asLandscape.res.text()).toContain("outside the landscape page");
		expect(asPortrait.res.status).toBe(200);
	});

	test("portrait elements can't be wider than the portrait page", async () => {
		const { cookie } = await tenantSession();
		const wide = portrait([textElement("x", { width: 720 })]);
		const { res } = await createDesign(cookie, wide as ReturnType<typeof layoutWith>);
		expect(res.status).toBe(422);
	});

	test("rejects unknown orientations", async () => {
		const { cookie } = await tenantSession();
		const { res } = await createDesign(cookie, { ...layoutWith(), orientation: "diagonal" } as ReturnType<typeof layoutWith>);
		expect(res.status).toBe(422);
	});

	test("certificates for portrait designs are tall A4 pages", async () => {
		const { tenant, cookie } = await tenantSession();
		const { design } = await createDesign(cookie, portrait([tall, { type: "qr", x: 450, y: 700, size: 100, color: "#000000" }]) as ReturnType<typeof layoutWith>);
		const attendee = await createAttendee((await createEvent(tenant.id, { designId: design.id })).id);

		const pdf = new Uint8Array(await (await call("GET", `/api/v1/events/certificate/${attendee.id}`)).arrayBuffer());

		expect(pdfPageCount(pdf)).toBe(1);
		expect(pdfPageSize(pdf)).toEqual({ width: 595.28, height: 841.89 });
	});

	test("preview renders portrait, and designs saved without an orientation stay landscape", async () => {
		const { cookie } = await tenantSession();
		const previewOf = async (layout: unknown) =>
			pdfPageSize(new Uint8Array(await (await call("POST", `${DESIGNS}/preview`, { cookie, body: { layout } })).arrayBuffer()));

		expect(await previewOf(portrait([tall]))).toEqual({ width: 595.28, height: 841.89 });
		expect(await previewOf(layoutWith())).toEqual({ width: 841.89, height: 595.28 });
	});
});

describe("certificate verification", () => {
	test("confirms a genuine certificate", async () => {
		const { tenant } = await tenantSession({ name: "Hospital Serdang" });
		const event = await createEvent(tenant.id, { name: "CPR Course" });
		const attendee = await createAttendee(event.id, "Siti");

		const body = await (await call("GET", `/api/v1/events/verify/${attendee.id}`)).json();

		expect(body).toMatchObject({
			valid: true,
			certificateId: attendee.id,
			attendeeName: "Siti",
			eventName: "CPR Course",
			hostName: "Hospital Serdang",
		});
		expect(body).not.toHaveProperty("email");
	});

	test("404 for unknown, 422 for malformed", async () => {
		expect((await call("GET", `/api/v1/events/verify/${MISSING_UUID}`)).status).toBe(404);
		expect((await call("GET", "/api/v1/events/verify/abc")).status).toBe(422);
	});
});
