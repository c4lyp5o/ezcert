import PDFDocument from "pdfkit";
import encodeQR from "qr";

import {
	fillPlaceholders,
	pageSize,
	type Layout,
	type Orientation,
	type PlaceholderValues,
	type TextElement,
} from "./layout";

const MIN_FONT_SIZE = 4;
const LINE_HEIGHT = 1.2;

export type AssetLoader = (assetId: string) => Promise<Buffer | null>;

export type RenderData = PlaceholderValues & { verifyUrl: string };

function drawText(
	doc: PDFKit.PDFDocument,
	el: TextElement,
	values: PlaceholderValues,
	pageHeight: number,
) {
	const text = fillPlaceholders(el.text, values);
	let size = el.fontSize;
	doc.font(el.font).fontSize(size);
	// Shrink long values (e.g. long names) to stay on one line inside the box
	while (size > MIN_FONT_SIZE && doc.widthOfString(text) > el.width) {
		doc.fontSize(--size);
	}
	// Clamp so the line never crosses the page bottom, which would make PDFKit add a page
	const y = Math.min(el.y, pageHeight - size * LINE_HEIGHT);
	doc.fillColor(el.color).text(text, el.x, y, {
		width: el.width,
		align: el.align,
		lineBreak: false,
	});
}

function drawQr(doc: PDFKit.PDFDocument, url: string, x: number, y: number, size: number, color: string) {
	const matrix = encodeQR(url, "raw");
	const cell = size / matrix.length;
	matrix.forEach((row, r) =>
		row.forEach((dark, c) => {
			if (dark) doc.rect(x + c * cell, y + r * cell, cell, cell);
		}),
	);
	doc.fillColor(color).fill();
}

/**
 * Draws a tenant design onto a fresh A4 page (create it with newCertificateDoc(layout.orientation)).
 * Missing assets are skipped so a deleted file never breaks certificate downloads.
 */
export async function renderDesign(
	doc: PDFKit.PDFDocument,
	layout: Layout,
	data: RenderData,
	loadAsset: AssetLoader,
): Promise<void> {
	const page = pageSize(layout.orientation);
	doc.rect(0, 0, page.width, page.height).fill(layout.backgroundColor);

	if (layout.backgroundAssetId) {
		const background = await loadAsset(layout.backgroundAssetId);
		if (background) doc.image(background, 0, 0, { width: page.width, height: page.height });
	}

	for (const el of layout.elements) {
		if (el.type === "text") {
			drawText(doc, el, data, page.height);
		} else if (el.type === "image") {
			const image = await loadAsset(el.assetId);
			if (image) doc.image(image, el.x, el.y, { width: el.width, height: el.height });
		} else {
			drawQr(doc, data.verifyUrl, el.x, el.y, el.size, el.color);
		}
	}
}

// Zero margins: every template positions content absolutely, and margins would trigger page breaks
export const newCertificateDoc = (orientation: Orientation = "landscape") =>
	new PDFDocument({
		size: "A4",
		layout: orientation,
		margin: 0,
		info: { Title: "Certificate", Producer: "EzCert" },
	});
