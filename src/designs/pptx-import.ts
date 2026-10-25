import { posix } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";

import { UploadError } from "./images";
import {
	MAX_ELEMENTS,
	pageSize,
	unknownPlaceholders,
	type FontName,
	type Orientation,
	type QrElement,
	type TextElement,
} from "./layout";

const MB = 1024 * 1024;

export const PPTX_LIMITS = {
	maxFileBytes: 10 * MB,
	maxEntries: 1000,
	// Checked against the zip directory before anything is decompressed (zip-bomb guard)
	maxUncompressedBytes: 60 * MB,
};

const EMU_PER_PT = 12700;
const DEFAULT_FONT_SIZE = 18;
const LINE_HEIGHT = 1.2;
// PowerPoint's default text box insets
const DEFAULT_INSET_X = 91440;
const DEFAULT_INSET_Y = 45720;
const QR_TOKEN = /^\{\{\s*qr\s*\}\}$/;

// Only the parts we read are decompressed; everything else in the zip is ignored
const NEEDED_PARTS =
	/^(\[Content_Types\]\.xml|ppt\/presentation\.xml|ppt\/_rels\/presentation\.xml\.rels|ppt\/(slides|slideLayouts|slideMasters)\/(_rels\/)?[A-Za-z0-9]+\.xml(\.rels)?|ppt\/media\/[^/]+)$/;

const ARRAY_TAGS = new Set([
	"p:sp",
	"p:pic",
	"p:grpSp",
	"p:graphicFrame",
	"p:cxnSp",
	"a:p",
	"a:r",
	"Relationship",
	"p:sldId",
]);

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	parseTagValue: false,
	htmlEntities: false,
	isArray: (name) => ARRAY_TAGS.has(name),
});

export type ImportedImage = {
	type: "image";
	data: Uint8Array;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
};

export type ImportedDesign = {
	orientation: Orientation;
	backgroundColor: string;
	background: Uint8Array | null;
	elements: Array<TextElement | QrElement | ImportedImage>;
	warnings: string[];
};

// fast-xml-parser output is untyped by nature
type Node = any;

type Rel = { target: string; type: string; external: boolean };

const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

function readZip(buf: Uint8Array): Record<string, Uint8Array> {
	if (buf.byteLength > PPTX_LIMITS.maxFileBytes) {
		throw new UploadError(413, `PPTX must be under ${PPTX_LIMITS.maxFileBytes / MB}MB`);
	}
	const isZip = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
	if (!isZip) throw new UploadError(415, "Not a .pptx file");

	let entries = 0;
	let uncompressed = 0;
	let hasMacros = false;
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(buf, {
			filter(file) {
				entries += 1;
				uncompressed += file.originalSize;
				if (entries > PPTX_LIMITS.maxEntries || uncompressed > PPTX_LIMITS.maxUncompressedBytes) {
					throw new UploadError(413, "PPTX is too large when unpacked");
				}
				if (/vbaProject\.bin$/i.test(file.name)) hasMacros = true;
				return NEEDED_PARTS.test(file.name);
			},
		});
	} catch (error) {
		if (error instanceof UploadError) throw error;
		throw new UploadError(422, "Could not read the PPTX file (it may be corrupt)");
	}

	const contentTypes = files["[Content_Types].xml"];
	if (hasMacros || (contentTypes && /macroEnabled/i.test(strFromU8(contentTypes)))) {
		throw new UploadError(415, "Macro-enabled presentations are not accepted");
	}
	return files;
}

const textOf = (value: unknown): string => {
	if (value == null) return "";
	if (typeof value === "object") return String((value as Node)["#text"] ?? "");
	return String(value);
};

const num = (value: unknown, fallback: number) => {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
};

function mapFont(typeface: string, bold: boolean, italic: boolean): FontName {
	const family = /courier|consolas|mono|menlo|lucida console/i.test(typeface)
		? "Courier"
		: /times|georgia|garamond|cambria|book|palatino|baskerville|serif/i.test(typeface) &&
				!/sans/i.test(typeface)
			? "Times"
			: "Helvetica";

	if (family === "Times") {
		if (bold && italic) return "Times-BoldItalic";
		if (bold) return "Times-Bold";
		return italic ? "Times-Italic" : "Times-Roman";
	}
	if (bold && italic) return `${family}-BoldOblique`;
	if (bold) return `${family}-Bold`;
	return italic ? `${family}-Oblique` : family;
}

class PptxReader {
	readonly warnings = new Set<string>();
	private readonly sx: number;
	private readonly sy: number;

	constructor(
		private readonly files: Record<string, Uint8Array>,
		slideWidthEmu: number,
		slideHeightEmu: number,
		private readonly page: { width: number; height: number },
	) {
		this.sx = page.width / (slideWidthEmu / EMU_PER_PT);
		this.sy = page.height / (slideHeightEmu / EMU_PER_PT);
	}

	xml(path: string): Node | null {
		const file = this.files[path];
		return file ? parser.parse(strFromU8(file)) : null;
	}

	rels(partPath: string): Map<string, Rel> {
		const relsPath = posix.join(posix.dirname(partPath), "_rels", `${posix.basename(partPath)}.rels`);
		const map = new Map<string, Rel>();
		for (const rel of this.xml(relsPath)?.Relationships?.Relationship ?? []) {
			const external = rel.TargetMode === "External";
			const target: string = String(rel.Target ?? "");
			map.set(rel.Id, {
				type: String(rel.Type ?? ""),
				external,
				target: external
					? target
					: target.startsWith("/")
						? target.slice(1)
						: posix.normalize(posix.join(posix.dirname(partPath), target)),
			});
		}
		return map;
	}

	box(xfrm: Node) {
		const off = xfrm?.["a:off"];
		const ext = xfrm?.["a:ext"];
		if (!off || !ext) return null;
		return {
			x: (num(off.x, 0) / EMU_PER_PT) * this.sx,
			y: (num(off.y, 0) / EMU_PER_PT) * this.sy,
			width: (num(ext.cx, 0) / EMU_PER_PT) * this.sx,
			height: (num(ext.cy, 0) / EMU_PER_PT) * this.sy,
		};
	}

	color(fill: Node, fallback: string): string {
		const hex = fill?.["a:srgbClr"]?.val;
		if (typeof hex === "string" && /^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}`;
		if (fill?.["a:schemeClr"]) {
			this.warnings.add("Theme colours aren't supported; use a custom (RGB) colour. Defaults were used.");
		}
		return fallback;
	}

	/** Slide → layout → master, the first one with an explicit background wins. */
	background(slidePath: string, root: Node): { color: string; image: Uint8Array | null } {
		let partPath = slidePath;
		let part = root;
		for (const nextType of ["/slideLayout", "/slideMaster", null]) {
			const bg = part?.["p:cSld"]?.["p:bg"];
			if (bg) {
				const props = bg["p:bgPr"];
				if (!props) {
					this.warnings.add("Theme backgrounds aren't supported; set Format Background → Solid fill or Picture.");
					break;
				}
				if (props["a:gradFill"]) {
					this.warnings.add("Gradient backgrounds aren't supported; export the gradient as a picture background.");
				}
				const embed = props["a:blipFill"]?.["a:blip"]?.["r:embed"];
				const rel = embed ? this.rels(partPath).get(embed) : undefined;
				const image = rel && !rel.external ? (this.files[rel.target] ?? null) : null;
				return { color: this.color(props["a:solidFill"], "#FFFFFF"), image };
			}
			if (!nextType) break;
			const next = [...this.rels(partPath).values()].find((r) => r.type.endsWith(nextType));
			if (!next) break;
			partPath = next.target;
			const doc = this.xml(partPath);
			part = doc?.["p:sldLayout"] ?? doc?.["p:sldMaster"];
		}
		return { color: "#FFFFFF", image: null };
	}

	shape(sp: Node): Array<TextElement | QrElement> {
		const name = sp?.["p:nvSpPr"]?.["p:cNvPr"]?.name ?? "shape";
		const body = sp?.["p:txBody"];
		const paragraphs = (body?.["a:p"] ?? [])
			.map((p: Node) => ({
				p,
				text: (p["a:r"] ?? []).map((r: Node) => textOf(r["a:t"])).join(""),
			}))
			.filter(({ text }: { text: string }) => text.trim());

		if (paragraphs.length === 0) {
			this.warnings.add("Decorative shapes were skipped; put decorations in the background picture.");
			return [];
		}
		const box = this.box(sp["p:spPr"]?.["a:xfrm"]);
		if (!box) {
			this.warnings.add(
				`"${name}" inherits its position from the slide layout; move it slightly in PowerPoint and save again.`,
			);
			return [];
		}
		if (num(sp["p:spPr"]["a:xfrm"].rot, 0) !== 0) {
			this.warnings.add("Rotated text isn't supported and was imported straight.");
		}

		const firstRun = (p: Node) => p["a:r"]?.[0]?.["a:rPr"] ?? p["a:endParaRPr"] ?? {};

		if (paragraphs.length === 1 && QR_TOKEN.test(paragraphs[0].text.trim())) {
			const size = clamp(Math.min(box.width, box.height), 24, 300);
			return [
				{
					type: "qr",
					x: round(clamp(box.x, 0, this.page.width - size)),
					y: round(clamp(box.y, 0, this.page.height - size)),
					size: round(size),
					color: this.color(firstRun(paragraphs[0].p)["a:solidFill"], "#000000"),
				},
			];
		}

		const bodyPr = body["a:bodyPr"] ?? {};
		const insetLeft = (num(bodyPr.lIns, DEFAULT_INSET_X) / EMU_PER_PT) * this.sx;
		const insetRight = (num(bodyPr.rIns, DEFAULT_INSET_X) / EMU_PER_PT) * this.sx;
		const insetTop = (num(bodyPr.tIns, DEFAULT_INSET_Y) / EMU_PER_PT) * this.sy;
		const insetBottom = (num(bodyPr.bIns, DEFAULT_INSET_Y) / EMU_PER_PT) * this.sy;

		const lines = paragraphs.map(({ p, text }: { p: Node; text: string }) => {
			const rPr = firstRun(p);
			const bold = rPr.b === "1" || rPr.b === "true";
			const italic = rPr.i === "1" || rPr.i === "true";
			const algn = p["a:pPr"]?.algn;
			for (const key of unknownPlaceholders(text)) {
				this.warnings.add(`Unknown placeholder {{${key}}} will be printed as-is.`);
			}
			return {
				text: text.trim(),
				fontSize: round(clamp((num(rPr.sz, DEFAULT_FONT_SIZE * 100) / 100) * this.sy, 4, 144)),
				font: mapFont(String(rPr["a:latin"]?.typeface ?? ""), bold, italic),
				color: this.color(rPr["a:solidFill"], "#000000"),
				align: algn === "ctr" ? "center" : algn === "r" ? "right" : "left",
			} as const;
		});

		const blockHeight = lines.reduce((sum: number, l: { fontSize: number }) => sum + l.fontSize * LINE_HEIGHT, 0);
		let cursor =
			bodyPr.anchor === "ctr"
				? box.y + (box.height - blockHeight) / 2
				: bodyPr.anchor === "b"
					? box.y + box.height - insetBottom - blockHeight
					: box.y + insetTop;

		const x = clamp(box.x + insetLeft, 0, this.page.width - 10);
		const width = clamp(box.width - insetLeft - insetRight, 10, this.page.width - x);
		return lines.map((line: Omit<TextElement, "type" | "x" | "y" | "width">) => {
			const el: TextElement = {
				type: "text",
				...line,
				x: round(x),
				y: round(clamp(cursor, 0, this.page.height - line.fontSize)),
				width: round(width),
			};
			cursor += line.fontSize * LINE_HEIGHT;
			return el;
		});
	}

	picture(pic: Node, rels: Map<string, Rel>): ImportedImage | null {
		const embed = pic?.["p:blipFill"]?.["a:blip"]?.["r:embed"];
		const rel = embed ? rels.get(embed) : undefined;
		if (!rel || rel.external) {
			this.warnings.add("Linked (external) pictures were skipped; insert pictures into the file instead.");
			return null;
		}
		const data = this.files[rel.target];
		const box = this.box(pic["p:spPr"]?.["a:xfrm"]);
		if (!data || !box) return null;

		const x = clamp(box.x, 0, this.page.width - 1);
		const y = clamp(box.y, 0, this.page.height - 1);
		return {
			type: "image",
			data,
			name: posix.basename(rel.target),
			x: round(x),
			y: round(y),
			width: round(clamp(box.width, 1, this.page.width - x)),
			height: round(clamp(box.height, 1, this.page.height - y)),
		};
	}
}

/**
 * Reads the first slide of an untrusted .pptx into a draft design.
 * Pure function: no I/O. Images come back raw and must go through sanitizeImage().
 */
export function importPptx(buf: Uint8Array): ImportedDesign {
	const files = readZip(buf);

	const presentation = parser.parse(strFromU8(files["ppt/presentation.xml"] ?? new Uint8Array()))?.[
		"p:presentation"
	];
	const slideSize = presentation?.["p:sldSz"];
	if (!presentation || !slideSize) throw new UploadError(422, "Not a PowerPoint presentation");

	const slideWidth = num(slideSize.cx, 0) || 1;
	const slideHeight = num(slideSize.cy, 0) || 1;
	// Taller-than-wide slides become portrait certificates
	const orientation: Orientation = slideHeight > slideWidth ? "portrait" : "landscape";
	const page = pageSize(orientation);

	const reader = new PptxReader(files, slideWidth, slideHeight, page);
	if (Math.abs(slideWidth / slideHeight - page.width / page.height) > 0.02) {
		reader.warnings.add(`The slide isn't A4 ${orientation}, so the design was stretched to fit.`);
	}

	const slideIds: Node[] = presentation["p:sldIdLst"]?.["p:sldId"] ?? [];
	if (slideIds.length > 1) reader.warnings.add("Only the first slide was imported.");
	const firstSlide = reader.rels("ppt/presentation.xml").get(slideIds[0]?.["r:id"]);
	const slidePath = firstSlide?.target ?? "ppt/slides/slide1.xml";
	const slide = reader.xml(slidePath)?.["p:sld"];
	if (!slide) throw new UploadError(422, "The presentation has no slides");

	const tree = slide["p:cSld"]?.["p:spTree"] ?? {};
	const slideRels = reader.rels(slidePath);

	if ((tree["p:grpSp"] ?? []).length > 0) {
		reader.warnings.add("Grouped objects were skipped; ungroup them in PowerPoint first.");
	}
	if ((tree["p:graphicFrame"] ?? []).length > 0) {
		reader.warnings.add("Tables, charts and SmartArt were skipped.");
	}
	if ((tree["p:cxnSp"] ?? []).length > 0) {
		reader.warnings.add("Lines and connectors were skipped; put them in the background picture.");
	}

	const { color, image } = reader.background(slidePath, slide);
	// Pictures first so text is drawn on top of them
	const elements: ImportedDesign["elements"] = [
		...(tree["p:pic"] ?? []).map((pic: Node) => reader.picture(pic, slideRels)).filter(Boolean),
		...(tree["p:sp"] ?? []).flatMap((sp: Node) => reader.shape(sp)),
	];

	if (elements.length > MAX_ELEMENTS) {
		reader.warnings.add(`Only the first ${MAX_ELEMENTS} elements were imported.`);
	}

	return {
		orientation,
		backgroundColor: color,
		background: image,
		elements: elements.slice(0, MAX_ELEMENTS),
		warnings: [...reader.warnings],
	};
}
