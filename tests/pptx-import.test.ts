import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import PptxGenJS from "pptxgenjs";

import { UploadError } from "../src/designs/images";
import { PPTX_LIMITS, importPptx } from "../src/designs/pptx-import";
import { starterTemplate } from "../src/designs/starter";
import { blob, call, pngBytes, tenantSession, upload } from "./helpers";

const IMPORT = "/api/v1/admin/designs/import";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

async function buildPptx(
	build: (slide: PptxGenJS.Slide, pptx: PptxGenJS) => void | Promise<void>,
	layout: "A4" | "16x9" = "A4",
) {
	const pptx = new PptxGenJS();
	if (layout === "A4") {
		pptx.defineLayout({ name: "A4L", width: 11.69, height: 8.27 });
		pptx.layout = "A4L";
	} else {
		pptx.layout = "LAYOUT_16x9";
	}
	const slide = pptx.addSlide();
	await build(slide, pptx);
	return new Uint8Array((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
}

const dataUri = async (color = "#ff0000", w = 40, h = 40) =>
	`image/png;base64,${(await pngBytes(w, h, color)).toString("base64")}`;

const expectUploadError = (fn: () => unknown, status: UploadError["status"]) => {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(UploadError);
		expect((error as UploadError).status).toBe(status);
		return;
	}
	throw new Error("expected UploadError");
};

describe("starter template", () => {
	test("is downloadable by tenants as a .pptx", async () => {
		const { cookie } = await tenantSession();
		const res = await call("GET", "/api/v1/admin/designs/starter.pptx", { cookie });
		const bytes = new Uint8Array(await res.arrayBuffer());

		expect(res.headers.get("content-type")).toBe(PPTX_MIME);
		expect(res.headers.get("content-disposition")).toContain("ezcert-template.pptx");
		expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
	});

	test("round-trips through the importer with every placeholder and no warnings", async () => {
		const draft = importPptx(new Uint8Array(await starterTemplate()));
		const texts = draft.elements.flatMap((e) => (e.type === "text" ? [e.text] : []));

		expect(draft.warnings).toEqual([]);
		expect(texts).toContain("{{attendee_name}}");
		expect(texts).toContain("{{event_name}}");
		expect(texts).toContain("{{date}} · {{location}}");
		expect(texts).toContain("Hosted by {{host_name}}");
		expect(texts).toContain("Certificate ID: {{certificate_id}}");
		expect(draft.elements.some((e) => e.type === "qr")).toBe(true);

		const name = draft.elements.find((e) => e.type === "text" && e.text === "{{attendee_name}}");
		expect(name).toMatchObject({ font: "Times-Bold", align: "center", color: "#111827" });
	});
});

describe("portrait PPTX", () => {
	test("portrait starter downloads with its own filename", async () => {
		const { cookie } = await tenantSession();
		const res = await call("GET", "/api/v1/admin/designs/starter.pptx?orientation=portrait", { cookie });
		expect(res.status).toBe(200);
		expect(res.headers.get("content-disposition")).toContain("ezcert-template-portrait.pptx");

		const bad = await call("GET", "/api/v1/admin/designs/starter.pptx?orientation=sideways", { cookie });
		expect(bad.status).toBe(422);
	});

	test("portrait starter round-trips as a portrait design with no warnings", async () => {
		const draft = importPptx(new Uint8Array(await starterTemplate("portrait")));
		const texts = draft.elements.flatMap((e) => (e.type === "text" ? [e.text] : []));

		expect(draft.orientation).toBe("portrait");
		expect(draft.warnings).toEqual([]);
		expect(texts).toContain("{{attendee_name}}");
		expect(draft.elements.some((e) => e.type === "qr")).toBe(true);
		// Everything sits inside the 595pt-wide portrait page
		for (const el of draft.elements) {
			const width = el.type === "qr" ? el.size : el.width;
			expect(el.x + width).toBeLessThanOrEqual(595.28 + 0.01);
		}
	});

	test("landscape decks are still detected as landscape", async () => {
		expect(importPptx(new Uint8Array(await starterTemplate("landscape"))).orientation).toBe("landscape");
	});

	test("import route returns a portrait layout that can be saved", async () => {
		const { cookie } = await tenantSession();
		const res = await upload(
			IMPORT,
			{ file: blob(await starterTemplate("portrait"), PPTX_MIME) },
			cookie,
			"tall.pptx",
		);
		const draft = await res.json();
		expect(draft.layout.orientation).toBe("portrait");

		const saved = await call("POST", "/api/v1/admin/designs", { cookie, body: { name: draft.name, layout: draft.layout } });
		expect(saved.status).toBe(200);
	});
});

describe("PPTX parsing", () => {
	test("maps position, size, font, colour and alignment into A4 points", async () => {
		const pptx = await buildPptx((slide) => {
			slide.addText("{{attendee_name}}", {
				x: 1,
				y: 2,
				w: 5,
				h: 1,
				fontSize: 30,
				fontFace: "Courier New",
				bold: true,
				italic: true,
				color: "FF0000",
				align: "right",
				valign: "top",
			});
		});
		const [el] = importPptx(pptx).elements;

		expect(el).toMatchObject({ type: "text", font: "Courier-BoldOblique", color: "#FF0000", align: "right" });
		if (el.type !== "text") throw new Error("expected text");
		expect(el.x).toBeCloseTo(72 + 7.2, 0); // 1in + default inset
		expect(el.fontSize).toBeCloseTo(30, 0);
		expect(el.width).toBeCloseTo(5 * 72 - 14.4, 0);
	});

	test("splits multi-paragraph text boxes into stacked lines", async () => {
		const pptx = await buildPptx((slide) => {
			slide.addText(
				[
					{ text: "Line one", options: { breakLine: true } },
					{ text: "Line two" },
				],
				{ x: 1, y: 1, w: 6, h: 2, fontSize: 20 },
			);
		});
		const lines = importPptx(pptx).elements.filter((e) => e.type === "text");
		expect(lines.map((l) => l.type === "text" && l.text)).toEqual(["Line one", "Line two"]);
		expect((lines[1] as { y: number }).y).toBeGreaterThan((lines[0] as { y: number }).y);
	});

	test("extracts pictures and picture backgrounds", async () => {
		const pptx = await buildPptx(async (slide) => {
			slide.background = { data: await dataUri("#00ff00", 100, 70) };
			slide.addImage({ data: await dataUri(), x: 0.5, y: 0.5, w: 1, h: 1 });
		});
		const draft = importPptx(pptx);
		const image = draft.elements.find((e) => e.type === "image");

		expect(draft.background).toBeInstanceOf(Uint8Array);
		if (image?.type !== "image") throw new Error("expected an image element");
		expect(image.data).toBeInstanceOf(Uint8Array);
		// 0.5in = 36pt; the slide is 841.68pt wide vs A4's 841.89pt, so allow rounding
		expect(image.x).toBeCloseTo(36, 0);
		expect(image.y).toBeCloseTo(36, 0);
		expect(image.width).toBeCloseTo(72, 0);
	});

	test("reads solid background colours", async () => {
		const pptx = await buildPptx((slide) => {
			slide.background = { color: "FFF8E7" };
			slide.addText("hi", { x: 1, y: 1, w: 2, h: 1 });
		});
		expect(importPptx(pptx).backgroundColor).toBe("#FFF8E7");
	});

	test("warns about skipped shapes, unknown placeholders and non-A4 slides", async () => {
		const pptx = await buildPptx((slide, p) => {
			slide.addShape(p.ShapeType.rect, { x: 1, y: 1, w: 2, h: 1, fill: { color: "FF0000" } });
			slide.addText("{{favourite_colour}}", { x: 1, y: 3, w: 4, h: 1 });
		}, "16x9");
		const { warnings } = importPptx(pptx);

		expect(warnings.some((w) => w.includes("Decorative shapes"))).toBe(true);
		expect(warnings.some((w) => w.includes("{{favourite_colour}}"))).toBe(true);
		expect(warnings.some((w) => w.includes("isn't A4"))).toBe(true);
	});
});

describe("PPTX upload safety", () => {
	test("rejects files that aren't zips", () => {
		expectUploadError(() => importPptx(strToU8("%PDF-1.7 definitely not a pptx")), 415);
	});

	test("rejects corrupt zips", () => {
		expectUploadError(() => importPptx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5])), 422);
	});

	test("rejects macro-enabled presentations", async () => {
		const withVba = zipSync({ "ppt/vbaProject.bin": strToU8("evil") });
		expectUploadError(() => importPptx(withVba), 415);

		const pptmTypes = zipSync({
			"[Content_Types].xml": strToU8(
				'<Types><Override ContentType="application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml"/></Types>',
			),
		});
		expectUploadError(() => importPptx(pptmTypes), 415);
	});

	test("rejects zip bombs before decompressing", () => {
		const original = PPTX_LIMITS.maxUncompressedBytes;
		PPTX_LIMITS.maxUncompressedBytes = 1024 * 1024;
		try {
			const bomb = zipSync({ "ppt/media/zeros.png": new Uint8Array(2 * 1024 * 1024) }, { level: 9 });
			expect(bomb.byteLength).toBeLessThan(20_000);
			expectUploadError(() => importPptx(bomb), 413);
		} finally {
			PPTX_LIMITS.maxUncompressedBytes = original;
		}
	});

	test("rejects zips with too many entries", () => {
		const original = PPTX_LIMITS.maxEntries;
		PPTX_LIMITS.maxEntries = 5;
		try {
			const files = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.txt`, strToU8("x")]));
			expectUploadError(() => importPptx(zipSync(files)), 413);
		} finally {
			PPTX_LIMITS.maxEntries = original;
		}
	});

	test("rejects zips without a presentation", () => {
		expectUploadError(() => importPptx(zipSync({ "hello.txt": strToU8("hi") })), 422);
	});
});

describe("import route", () => {
	test("requires a tenant session", async () => {
		const res = await upload(IMPORT, { file: blob(await starterTemplate(), PPTX_MIME) }, undefined, "t.pptx");
		expect(res.status).toBe(401);
	});

	test("stores embedded images as sanitised assets and returns a saveable draft", async () => {
		const { cookie } = await tenantSession();
		const pptx = await buildPptx(async (slide) => {
			slide.background = { data: await dataUri("#00ff00", 100, 70) };
			slide.addImage({ data: await dataUri(), x: 0.5, y: 0.5, w: 1, h: 1 });
			slide.addText("{{attendee_name}}", { x: 1, y: 3, w: 9, h: 1, fontSize: 36 });
		});

		const res = await upload(IMPORT, { file: blob(pptx, PPTX_MIME) }, cookie, "My Gala.pptx");
		const draft = await res.json();

		expect(res.status).toBe(200);
		expect(draft.name).toBe("My Gala");
		expect(draft.warnings).toEqual([]);
		expect(draft.layout.backgroundAssetId).toBeString();
		expect(draft.layout.elements.find((e: { type: string }) => e.type === "image").assetId).toBeString();

		const assets = await (await call("GET", "/api/v1/admin/assets", { cookie })).json();
		expect(assets.map((a: { kind: string }) => a.kind).sort()).toEqual(["background", "image"]);

		// The draft is valid input for saving as-is
		const saved = await call("POST", "/api/v1/admin/designs", {
			cookie,
			body: { name: draft.name, layout: draft.layout },
		});
		expect(saved.status).toBe(200);
	});

	test("reports a clear error for non-PPTX uploads", async () => {
		const { cookie } = await tenantSession();
		const res = await upload(IMPORT, { file: blob("not a deck", PPTX_MIME) }, cookie, "x.pptx");
		expect(res.status).toBe(415);
		expect(await res.text()).toContain("Not a .pptx file");
	});
});
