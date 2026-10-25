import { t, type Static } from "elysia";

// A4 in PDF points; every layout coordinate uses this space
const A4_LONG = 841.89;
const A4_SHORT = 595.28;

export const ORIENTATIONS = ["landscape", "portrait"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const pageSize = (orientation: Orientation = "landscape") =>
	orientation === "portrait"
		? { width: A4_SHORT, height: A4_LONG }
		: { width: A4_LONG, height: A4_SHORT };

export const MAX_ELEMENTS = 40;

// PDF standard fonts: always available, no font files to upload or embed
export const FONTS = [
	"Helvetica",
	"Helvetica-Bold",
	"Helvetica-Oblique",
	"Helvetica-BoldOblique",
	"Times-Roman",
	"Times-Bold",
	"Times-Italic",
	"Times-BoldItalic",
	"Courier",
	"Courier-Bold",
	"Courier-Oblique",
	"Courier-BoldOblique",
] as const;
export type FontName = (typeof FONTS)[number];

export const PLACEHOLDERS = [
	"attendee_name",
	"event_name",
	"date",
	"location",
	"host_name",
	"certificate_id",
	// IC placeholders are blank unless the event collects IC (CPD)
	"ic", // full IC, e.g. 900101-14-5678
	"ic_masked", // last 4 digits only
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export type PlaceholderValues = Record<Placeholder, string>;

export const PLACEHOLDER_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

// The schema allows either orientation; layoutBoundsError() then checks against the actual page
const hexColor = t.String({ pattern: "^#[0-9a-fA-F]{6}$" });
const x = t.Number({ minimum: 0, maximum: A4_LONG });
const y = t.Number({ minimum: 0, maximum: A4_LONG });
const assetId = t.String({ format: "uuid" });

export const TextElementSchema = t.Object({
	type: t.Literal("text"),
	text: t.String({ minLength: 1, maxLength: 300 }),
	x,
	y,
	width: t.Number({ minimum: 10, maximum: A4_LONG }),
	fontSize: t.Number({ minimum: 4, maximum: 144 }),
	font: t.UnionEnum(FONTS),
	color: hexColor,
	align: t.UnionEnum(["left", "center", "right"]),
});

export const ImageElementSchema = t.Object({
	type: t.Literal("image"),
	assetId,
	x,
	y,
	width: t.Number({ minimum: 1, maximum: A4_LONG }),
	height: t.Number({ minimum: 1, maximum: A4_LONG }),
});

// Verification QR code linking to /verify/:certificateId
export const QrElementSchema = t.Object({
	type: t.Literal("qr"),
	x,
	y,
	size: t.Number({ minimum: 24, maximum: 300 }),
	color: hexColor,
});

export const LayoutSchema = t.Object({
	// Optional for designs saved before portrait support; missing means landscape
	orientation: t.Optional(t.UnionEnum(ORIENTATIONS)),
	backgroundColor: hexColor,
	backgroundAssetId: t.Union([assetId, t.Null()]),
	elements: t.Array(
		t.Union([TextElementSchema, ImageElementSchema, QrElementSchema]),
		{ maxItems: MAX_ELEMENTS },
	),
});

export type TextElement = Static<typeof TextElementSchema>;
export type ImageElement = Static<typeof ImageElementSchema>;
export type QrElement = Static<typeof QrElementSchema>;
export type Layout = Static<typeof LayoutSchema>;

/** Returns a message if any element starts outside the page for the layout's orientation. */
export function layoutBoundsError(layout: Layout): string | null {
	const page = pageSize(layout.orientation);
	const outside = layout.elements.findIndex(
		(el) =>
			el.x > page.width ||
			el.y > page.height ||
			(el.type === "image" && (el.width > page.width || el.height > page.height)) ||
			(el.type === "text" && el.width > page.width),
	);
	return outside === -1
		? null
		: `Element ${outside + 1} is outside the ${layout.orientation ?? "landscape"} page`;
}

export const fillPlaceholders =(text: string, values: PlaceholderValues) =>
	text.replace(PLACEHOLDER_PATTERN, (match, key: string) =>
		key in values ? values[key as Placeholder] : match,
	);

export const unknownPlaceholders = (text: string): string[] =>
	[...text.matchAll(PLACEHOLDER_PATTERN)]
		.map((m) => m[1])
		.filter((key) => !(PLACEHOLDERS as readonly string[]).includes(key));

/** Every asset a layout depends on, so ownership can be checked in one query. */
export const layoutAssetIds = (layout: Layout): string[] => [
	...new Set([
		...(layout.backgroundAssetId ? [layout.backgroundAssetId] : []),
		...layout.elements.flatMap((e) => (e.type === "image" ? [e.assetId] : [])),
	]),
];

export const SAMPLE_VALUES: PlaceholderValues = {
	attendee_name: "Nur Aisyah binti Ahmad",
	event_name: "Sample Event 2026",
	date: "25 October 2026",
	location: "Putrajaya",
	host_name: "Your Organisation",
	certificate_id: "00000000-0000-4000-8000-000000000000",
	ic: "900101-14-1234",
	ic_masked: "******-**-1234",
};
