import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import { QUOTAS } from "../src/modules/designs";
import { storage } from "../src/storage";
import { uploadDir } from "./setup";
import {
	MISSING_UUID,
	blob,
	call,
	layoutWith,
	noisyPng,
	pngBytes,
	tenantSession,
	upload,
	uploadAsset,
} from "./helpers";

const ASSETS = "/api/v1/admin/assets";

describe("asset uploads are gated", () => {
	test("require a tenant session", async () => {
		const res = await upload(ASSETS, { file: blob(await pngBytes(), "image/png"), kind: "logo" });
		expect(res.status).toBe(401);
	});

	test("reject unknown asset kinds", async () => {
		const { cookie } = await tenantSession();
		const res = await upload(ASSETS, { file: blob(await pngBytes(), "image/png"), kind: "favicon" }, cookie);
		expect(res.status).toBe(422);
	});
});

describe("asset uploads are sanitised", () => {
	test("stores a re-encoded PNG and reports its dimensions", async () => {
		const { cookie } = await tenantSession();
		const res = await upload(ASSETS, { file: blob(await pngBytes(120, 40), "image/png"), kind: "logo" }, cookie);
		const asset = await res.json();

		expect(res.status).toBe(200);
		expect(asset).toMatchObject({ kind: "logo", mime: "image/png", width: 120, height: 40 });
	});

	test("decodes the file instead of trusting its name or MIME type", async () => {
		const { cookie } = await tenantSession();
		const fakePng = blob("<?php system($_GET['x']); ?>", "image/png");
		const res = await upload(ASSETS, { file: fakePng, kind: "logo" }, cookie, "evil.png");
		expect(res.status).toBe(415);
	});

	test("rejects SVG (can carry scripts)", async () => {
		const { cookie } = await tenantSession();
		const svg = blob('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "image/svg+xml");
		const res = await upload(ASSETS, { file: svg, kind: "logo" }, cookie, "logo.svg");
		expect(res.status).toBe(415);
	});

	test("enforces per-kind size limits", async () => {
		const { cookie } = await tenantSession();
		const big = await noisyPng(800, 800); // ~1.9MB, over the 1MB logo limit
		const res = await upload(ASSETS, { file: blob(big, "image/png"), kind: "logo" }, cookie);
		expect(res.status).toBe(413);
	});

	test("strips EXIF metadata (e.g. GPS) and flattens backgrounds to JPEG", async () => {
		const { cookie } = await tenantSession();
		const withExif = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#ffcc00" } })
			.jpeg()
			.withExif({ IFD0: { Artist: "secret-author", Copyright: "gps-ish" } })
			.toBuffer();
		expect((await sharp(withExif).metadata()).exif).toBeDefined();

		const res = await upload(ASSETS, { file: blob(withExif, "image/jpeg"), kind: "background" }, cookie);
		const asset = await res.json();
		const file = await call("GET", `${ASSETS}/${asset.id}/file`, { cookie });
		const stored = Buffer.from(await file.arrayBuffer());

		expect(asset.mime).toBe("image/jpeg");
		expect((await sharp(stored).metadata()).exif).toBeUndefined();
		expect(stored.includes(Buffer.from("secret-author"))).toBe(false);
	});

	test("keeps full resolution for portrait and landscape A4 backgrounds", async () => {
		const { cookie } = await tenantSession();
		const sizes = [];
		for (const [w, h] of [[2480, 3508], [3508, 2480]]) {
			const jpeg = await sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
			const res = await upload(ASSETS, { file: blob(jpeg, "image/jpeg"), kind: "background" }, cookie);
			sizes.push(await res.json());
		}
		expect(sizes[0]).toMatchObject({ width: 2480, height: 3508 });
		expect(sizes[1]).toMatchObject({ width: 3508, height: 2480 });
	});

	test("downscales oversized images", async () => {
		const { cookie } = await tenantSession();
		const res = await upload(ASSETS, { file: blob(await pngBytes(3000, 1000), "image/png"), kind: "image" }, cookie);
		expect(await res.json()).toMatchObject({ width: 2000, height: 667 });
	});
});

describe("asset access", () => {
	test("owner can fetch the file with safe headers", async () => {
		const { cookie } = await tenantSession();
		const asset = await uploadAsset(cookie);
		const res = await call("GET", `${ASSETS}/${asset.id}/file`, { cookie });

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
	});

	test("another tenant cannot list, fetch or delete it", async () => {
		const owner = await tenantSession();
		const intruder = await tenantSession();
		const asset = await uploadAsset(owner.cookie);

		const list = await (await call("GET", ASSETS, { cookie: intruder.cookie })).json();
		const fetch = await call("GET", `${ASSETS}/${asset.id}/file`, { cookie: intruder.cookie });
		const del = await call("DELETE", `${ASSETS}/${asset.id}`, { cookie: intruder.cookie });

		expect(list).toEqual([]);
		expect(fetch.status).toBe(404);
		expect(del.status).toBe(404);
	});

	test("files are stored under the tenant's folder with random names", async () => {
		const { tenant, cookie } = await tenantSession();
		await uploadAsset(cookie);
		const files = readdirSync(join(uploadDir, tenant.id));
		expect(files).toHaveLength(1);
		expect(files[0]).toMatch(/^[0-9a-f-]{36}\.png$/);
	});

	test("storage refuses path traversal keys", async () => {
		await expect(storage.get("../../etc/passwd")).rejects.toThrow("Invalid storage key");
		await expect(storage.put("a/../../x.png", new Uint8Array())).rejects.toThrow("Invalid storage key");
	});
});

describe("asset deletion and quotas", () => {
	test("deleting removes the row and the file", async () => {
		const { tenant, cookie } = await tenantSession();
		const asset = await uploadAsset(cookie);

		const res = await call("DELETE", `${ASSETS}/${asset.id}`, { cookie });

		expect(res.status).toBe(200);
		expect(readdirSync(join(uploadDir, tenant.id))).toHaveLength(0);
		expect((await call("GET", `${ASSETS}/${asset.id}/file`, { cookie })).status).toBe(404);
	});

	test("an image used by a design cannot be deleted", async () => {
		const { cookie } = await tenantSession();
		const asset = await uploadAsset(cookie);
		await call("POST", "/api/v1/admin/designs", {
			cookie,
			body: { name: "Uses logo", layout: layoutWith([], asset.id) },
		});

		const res = await call("DELETE", `${ASSETS}/${asset.id}`, { cookie });
		expect(res.status).toBe(409);
		expect(await res.text()).toContain("Uses logo");
	});

	test("enforces the per-tenant file quota", async () => {
		const original = QUOTAS.maxAssets;
		QUOTAS.maxAssets = 1;
		try {
			const { cookie } = await tenantSession();
			await uploadAsset(cookie);
			const res = await upload(ASSETS, { file: blob(await pngBytes(), "image/png"), kind: "logo" }, cookie);
			expect(res.status).toBe(409);
		} finally {
			QUOTAS.maxAssets = original;
		}
	});

	test("rate-limits bursts of uploads", async () => {
		const { cookie } = await tenantSession();
		const png = await pngBytes(8, 8);
		const statuses: number[] = [];
		for (let i = 0; i < 31; i++) {
			const res = await upload(ASSETS, { file: blob(png, "image/png"), kind: "logo" }, cookie);
			statuses.push(res.status);
		}
		expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
		expect(statuses[30]).toBe(429);
	});

	test("404 for unknown asset, 422 for malformed id", async () => {
		const { cookie } = await tenantSession();
		expect((await call("DELETE", `${ASSETS}/${MISSING_UUID}`, { cookie })).status).toBe(404);
		expect((await call("GET", `${ASSETS}/nope/file`, { cookie })).status).toBe(422);
		expect(existsSync(uploadDir)).toBe(true);
	});
});
