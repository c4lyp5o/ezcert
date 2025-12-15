type CertData = {
	attendeeName: string;
	tenantName: string;
	eventName: string;
	date: string;
	location: string;
};

// Helper to center text
function centerText(
	doc: PDFKit.PDFDocument,
	text: string,
	y: number,
	size: number,
	font: string = "Helvetica",
	color: string = "black",
) {
	doc
		.font(font)
		.fontSize(size)
		.fillColor(color)
		.text(text, 0, y, { align: "center", width: doc.page.width });
}

export const generateCertificate = (
	doc: PDFKit.PDFDocument,
	template: string,
	data: CertData,
) => {
	const { width, height } = doc.page;

	switch (template) {
		case "tech-dark":
			// Style 1: Modern Tech (Dark Theme)
			doc.rect(0, 0, width, height).fill("#18181b"); // Zinc-900 bg

			// Accents
			doc.rect(0, 0, 20, height).fill("#2563eb"); // Blue strip left
			doc.rect(width - 20, 0, 20, height).fill("#2563eb"); // Blue strip right

			centerText(
				doc,
				"CERTIFICATE OF COMPLETION",
				100,
				30,
				"Helvetica-Bold",
				"#a1a1aa",
			);
			centerText(doc, "PROUDLY PRESENTED TO", 180, 15, "Helvetica", "#71717a");

			centerText(doc, data.attendeeName, 220, 50, "Helvetica-Bold", "white");

			doc
				.moveTo(150, 290)
				.lineTo(width - 150, 290)
				.strokeColor("#3f3f46")
				.stroke();

			centerText(
				doc,
				"For successfully attending",
				320,
				15,
				"Helvetica",
				"#a1a1aa",
			);
			centerText(doc, data.eventName, 350, 25, "Helvetica-Bold", "#3b82f6"); // Blue event name
			centerText(
				doc,
				`Hosted by ${data.tenantName}`,
				390,
				15,
				"Helvetica",
				"#71717a",
			);
			centerText(
				doc,
				`${data.date} • ${data.location}`,
				400,
				12,
				"Helvetica",
				"#71717a",
			);
			break;

		case "elegant-gold":
			// Style 2: Elegant (Cream & Gold)
			doc.rect(0, 0, width, height).fill("#fffbeb"); // Cream bg

			// Border
			doc
				.rect(20, 20, width - 40, height - 40)
				.lineWidth(5)
				.strokeColor("#b45309")
				.stroke(); // Gold border
			doc
				.rect(25, 25, width - 50, height - 50)
				.lineWidth(1)
				.strokeColor("#b45309")
				.stroke(); // Inner thin border

			centerText(doc, "CERTIFICATE", 80, 50, "Times-Roman", "#78350f");
			centerText(doc, "OF ATTENDANCE", 130, 20, "Times-Roman", "#92400e");

			centerText(doc, "This certifies that", 200, 15, "Times-Roman", "#b45309");
			centerText(
				doc,
				data.attendeeName,
				240,
				45,
				"Times-BoldItalic",
				"#000000",
			);

			centerText(doc, "has participated in", 320, 15, "Times-Roman", "#b45309");
			centerText(doc, data.eventName, 350, 25, "Times-Bold", "#78350f");
			centerText(
				doc,
				`Hosted by ${data.tenantName}`,
				390,
				15,
				"Times-Italic",
				"#92400e",
			);
			centerText(
				doc,
				`on ${data.date} at ${data.location}`,
				420,
				12,
				"Times-Roman",
				"#78350f",
			);
			break;

		case "retro-pixel":
			// Style 3: Retro / Pixel (Green)
			doc.rect(0, 0, width, height).fill("#000000"); // Black

			// Matrix-style border
			doc.lineWidth(2).strokeColor("#22c55e");
			doc.rect(10, 10, width - 20, height - 20).stroke();

			centerText(
				doc,
				">>> CERTIFICATE_LOADED_SUCCESSFULLY",
				80,
				20,
				"Courier-Bold",
				"#22c55e",
			);
			centerText(doc, "USER_ID:", 160, 15, "Courier", "#4ade80");

			centerText(
				doc,
				data.attendeeName.toUpperCase(),
				200,
				40,
				"Courier-Bold",
				"white",
			);

			centerText(doc, "EVENT_LOG:", 300, 15, "Courier", "#4ade80");
			centerText(
				doc,
				data.eventName.toUpperCase(),
				330,
				25,
				"Courier",
				"#22c55e",
			);
			centerText(
				doc,
				`Hosted by ${data.tenantName}`,
				370,
				15,
				"Courier",
				"#4ade80",
			);
			centerText(
				doc,
				`// ${data.date} @ ${data.location}`,
				380,
				12,
				"Courier",
				"#15803d",
			);
			break;

		default:
			// Default: Clean Minimal
			doc.rect(0, 0, width, height).fill("white");
			doc.rect(0, 0, width, 15).fill("#3f3f46"); // Top bar
			doc.rect(0, height - 15, width, 15).fill("#3f3f46"); // Bottom bar

			centerText(
				doc,
				"CERTIFICATE OF ATTENDANCE",
				120,
				30,
				"Helvetica-Bold",
				"#333",
			);
			centerText(doc, "Presented to", 180, 15, "Helvetica", "#666");
			centerText(doc, data.attendeeName, 220, 40, "Helvetica-Bold", "black");
			centerText(
				doc,
				`For attending ${data.eventName}`,
				320,
				20,
				"Helvetica",
				"#444",
			);
			centerText(
				doc,
				`Hosted by ${data.tenantName}`,
				350,
				15,
				"Helvetica",
				"#666",
			);
			centerText(
				doc,
				`${data.date} • ${data.location}`,
				360,
				12,
				"Helvetica",
				"#666",
			);
			break;
	}
};
