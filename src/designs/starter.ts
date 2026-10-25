import PptxGenJS from "pptxgenjs";

import { PLACEHOLDERS, type Orientation } from "./layout";

// A4 in inches
const A4_LONG = 11.69;
const A4_SHORT = 8.27;
const MARGIN = 0.75;

const notes = (orientation: Orientation) => `EzCert certificate template — how to use

1. Keep the slide size (A4 ${orientation}) and edit only the FIRST slide.
2. Text boxes may contain these placeholders, which are filled per attendee:
   ${PLACEHOLDERS.map((p) => `{{${p}}}`).join("  ")}
   A text box containing only {{qr}} becomes the verification QR code.
3. Style text freely: font, size, bold/italic, RGB colour and alignment are imported.
   Fonts are matched to Helvetica, Times or Courier.
4. Logos, signatures and other pictures: insert them as pictures (PNG/JPEG/WebP).
5. Backgrounds: Format Background → Solid fill (custom RGB colour) or Picture.
6. Shapes, lines, gradients, groups, tables and SmartArt are NOT imported.
   Put decorations into a background picture instead.
7. Save as .pptx (not .pptm) and upload it in EzCert → Certificate Designs → Import PPTX.`;

type Box = { text: string; y: number; h: number; size: number; bold?: boolean; italic?: boolean; color?: string };

// Vertical rhythm per orientation; portrait gets smaller type to fit the narrower page
const BOXES: Record<Orientation, Box[]> = {
	landscape: [
		{ text: "CERTIFICATE OF ATTENDANCE", y: 1.0, h: 0.8, size: 32, bold: true, color: "1F2937" },
		{ text: "This is to certify that", y: 2.1, h: 0.5, size: 16, italic: true, color: "4B5563" },
		{ text: "{{attendee_name}}", y: 2.7, h: 0.9, size: 40, bold: true, color: "111827" },
		{ text: "has attended", y: 3.75, h: 0.5, size: 16, italic: true, color: "4B5563" },
		{ text: "{{event_name}}", y: 4.3, h: 0.7, size: 26, bold: true, color: "1D4ED8" },
		{ text: "{{date}} · {{location}}", y: 5.1, h: 0.5, size: 14, color: "4B5563" },
		{ text: "Hosted by {{host_name}}", y: 5.6, h: 0.5, size: 14, color: "4B5563" },
	],
	portrait: [
		{ text: "CERTIFICATE", y: 1.6, h: 0.8, size: 36, bold: true, color: "1F2937" },
		{ text: "OF ATTENDANCE", y: 2.4, h: 0.5, size: 18, color: "1F2937" },
		{ text: "This is to certify that", y: 3.7, h: 0.5, size: 16, italic: true, color: "4B5563" },
		{ text: "{{attendee_name}}", y: 4.4, h: 0.9, size: 32, bold: true, color: "111827" },
		{ text: "has attended", y: 5.6, h: 0.5, size: 16, italic: true, color: "4B5563" },
		{ text: "{{event_name}}", y: 6.3, h: 0.7, size: 24, bold: true, color: "1D4ED8" },
		{ text: "{{date}} · {{location}}", y: 7.3, h: 0.5, size: 14, color: "4B5563" },
		{ text: "Hosted by {{host_name}}", y: 7.8, h: 0.5, size: 14, color: "4B5563" },
	],
};

const cache = new Map<Orientation, Buffer>();

/** Builds (once per orientation) the downloadable starter template with every supported placeholder. */
export async function starterTemplate(orientation: Orientation = "landscape"): Promise<Buffer> {
	const cached = cache.get(orientation);
	if (cached) return cached;

	const width = orientation === "portrait" ? A4_SHORT : A4_LONG;
	const height = orientation === "portrait" ? A4_LONG : A4_SHORT;

	const pptx = new PptxGenJS();
	pptx.defineLayout({ name: `A4_${orientation.toUpperCase()}`, width, height });
	pptx.layout = `A4_${orientation.toUpperCase()}`;
	pptx.title = `EzCert certificate template (${orientation})`;

	const slide = pptx.addSlide();
	slide.background = { color: "FFFFFF" };

	for (const box of BOXES[orientation]) {
		slide.addText(box.text, {
			x: MARGIN,
			y: box.y,
			w: width - MARGIN * 2,
			h: box.h,
			fontSize: box.size,
			fontFace: "Georgia",
			bold: box.bold,
			italic: box.italic,
			color: box.color,
			align: "center",
			valign: "middle",
		});
	}

	slide.addText("Certificate ID: {{certificate_id}}", {
		x: 0.5,
		y: height - 0.8,
		w: Math.min(5, width - 2.5),
		h: 0.4,
		fontSize: 9,
		fontFace: "Arial",
		color: "6B7280",
		align: "left",
	});
	slide.addText("{{qr}}", {
		x: width - 1.7,
		y: height - 1.9,
		w: 1.2,
		h: 1.2,
		fontSize: 10,
		color: "111827",
		align: "center",
		valign: "middle",
	});
	slide.addNotes(notes(orientation));

	const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
	cache.set(orientation, buffer);
	return buffer;
}
