import { describe, expect, test } from "bun:test";
import PDFDocument from "pdfkit";

import { TEMPLATE_IDS, generateCertificate } from "../src/cert-templates";

const longData = {
	attendeeName: "Dr. Muhammad Aiman Bin Abdul Rahman Al-Hafiz Shahrizal Iskandar",
	tenantName: "Kementerian Kesihatan Malaysia",
	eventName: "Annual Clinical Governance & Patient Safety Symposium 2026 (Hybrid)",
	date: "25 October 2026",
	location: "Pusat Konvensyen Antarabangsa Putrajaya",
};

const render = (template: string) => {
	const doc = new PDFDocument({ layout: "landscape", size: "A4", margin: 0, bufferPages: true });
	generateCertificate(doc, template, { ...longData, certificateId: crypto.randomUUID() });
	const pages = doc.bufferedPageRange().count;
	doc.end();
	return pages;
};

describe("certificate templates", () => {
	test.each([...TEMPLATE_IDS])("%s keeps very long text on a single page", (template) => {
		expect(render(template)).toBe(1);
	});

	test("unknown template falls back to the default without throwing", () => {
		expect(render("does-not-exist")).toBe(1);
	});
});
