import { app } from "../src/app";
import { attendees, events, superAdmins, tenants } from "../src/db/schema";
import { testDb } from "./setup";

const BASE = "http://localhost";
// Low bcrypt cost keeps tests fast; Bun.password.verify auto-detects the algorithm
const hash = (password: string) =>
	Bun.password.hash(password, { algorithm: "bcrypt", cost: 4 });

export const PASSWORD = "correct-horse";

type RequestOptions = { body?: unknown; cookie?: string; headers?: Record<string, string> };

export async function call(
	method: string,
	path: string,
	{ body, cookie, headers: extra }: RequestOptions = {},
): Promise<Response> {
	const headers: Record<string, string> = { ...extra };
	if (body !== undefined) headers["content-type"] = "application/json";
	if (cookie) headers.cookie = cookie;

	return app.handle(
		new Request(BASE + path, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
}

/** Returns "name=value" for the named cookie set by a response, or null. */
export function cookieFrom(res: Response, name: string): string | null {
	for (const header of res.headers.getSetCookie()) {
		const [pair] = header.split(";");
		if (pair.startsWith(`${name}=`)) return pair;
	}
	return null;
}

export async function createTenant(
	overrides: Partial<typeof tenants.$inferInsert> = {},
) {
	const [tenant] = await testDb
		.insert(tenants)
		.values({
			name: "Acme Clinic",
			email: `tenant-${crypto.randomUUID()}@example.com`,
			status: "ACTIVE",
			...overrides,
			password: await hash(overrides.password ?? PASSWORD),
		})
		.returning();
	return tenant;
}

export async function loginTenant(email: string, password = PASSWORD) {
	const res = await call("POST", "/api/v1/auth/admin/login", {
		body: { email, password },
	});
	const cookie = cookieFrom(res, "admin_token");
	if (!cookie) throw new Error(`Login failed for ${email}`);
	return cookie;
}

/** Creates an ACTIVE tenant and returns it with a logged-in cookie. */
export async function tenantSession(
	overrides: Partial<typeof tenants.$inferInsert> = {},
) {
	const tenant = await createTenant(overrides);
	return { tenant, cookie: await loginTenant(tenant.email) };
}

export async function superSession(username = "oracle") {
	const [admin] = await testDb
		.insert(superAdmins)
		.values({ username, password: await hash(PASSWORD) })
		.returning();
	const res = await call("POST", "/api/v1/auth/super/login", {
		body: { username, password: PASSWORD },
	});
	const cookie = cookieFrom(res, "super_token");
	if (!cookie) throw new Error("Superadmin login failed");
	return { admin, cookie };
}

export async function createEvent(
	tenantId: string,
	overrides: Partial<typeof events.$inferInsert> = {},
) {
	const [event] = await testDb
		.insert(events)
		.values({
			tenantId,
			name: "Patient Safety Symposium",
			date: new Date("2026-10-25T09:00:00Z"),
			location: "Putrajaya",
			isOpen: true,
			...overrides,
		})
		.returning();
	return event;
}

export async function createAttendee(eventId: string, name = "Jane Doe") {
	const [attendee] = await testDb
		.insert(attendees)
		.values({ eventId, name, email: `${crypto.randomUUID()}@example.com` })
		.returning();
	return attendee;
}

export const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

/** Multipart request, as the browser sends file uploads. */
export function upload(
	path: string,
	fields: Record<string, string | Blob>,
	cookie?: string,
	filename = "upload.bin",
): Promise<Response> {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		if (value instanceof Blob) form.append(key, value, filename);
		else form.append(key, value);
	}
	return app.handle(
		new Request(BASE + path, {
			method: "POST",
			headers: cookie ? { cookie } : {},
			body: form,
		}),
	);
}

export async function pngBytes(width = 64, height = 32, color = "#2563eb") {
	const { default: sharp } = await import("sharp");
	return sharp({ create: { width, height, channels: 4, background: color } })
		.png()
		.toBuffer();
}

/** Random noise doesn't compress, so this reliably produces a large PNG. */
export async function noisyPng(width: number, height: number) {
	const { default: sharp } = await import("sharp");
	const raw = crypto.getRandomValues(new Uint8Array(width * height * 3));
	return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

export const blob = (data: Uint8Array | string, type: string) =>
	new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type });

export async function uploadAsset(cookie: string, kind = "logo") {
	const res = await upload(
		"/api/v1/admin/assets",
		{ file: blob(await pngBytes(), "image/png"), kind },
		cookie,
		"logo.png",
	);
	if (res.status !== 200) throw new Error(`Asset upload failed: ${res.status}`);
	return (await res.json()) as { id: string };
}

export const textElement = (text = "{{attendee_name}}", overrides = {}) => ({
	type: "text" as const,
	text,
	x: 60,
	y: 200,
	width: 720,
	fontSize: 32,
	font: "Times-Bold" as const,
	color: "#111827",
	align: "center" as const,
	...overrides,
});

export const layoutWith = (elements: unknown[] = [textElement()], backgroundAssetId: string | null = null) => ({
	backgroundColor: "#FFFFFF",
	backgroundAssetId,
	elements,
});

/** Page objects in a PDF ("/Type /Page", not "/Type /Pages"). */
export const pdfPageCount = (pdf: Uint8Array) =>
	(Buffer.from(pdf).toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;

/** Page size of the first page, from its MediaBox (PDF points). */
export function pdfPageSize(pdf: Uint8Array) {
	const match = Buffer.from(pdf)
		.toString("latin1")
		.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
	if (!match) throw new Error("No MediaBox in PDF");
	return { width: Number(match[1]), height: Number(match[2]) };
}

export const pdfHasImage =(pdf: Uint8Array) =>
	Buffer.from(pdf).toString("latin1").includes("/Subtype /Image");
