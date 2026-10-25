// Mirrors src/designs/layout.ts on the server (the server validates everything again).

export type Orientation = "landscape" | "portrait";

// A4 in PDF points
export const pageSize = (orientation: Orientation = "landscape") =>
  orientation === "portrait"
    ? { width: 595.28, height: 841.89 }
    : { width: 841.89, height: 595.28 };

export const MAX_ELEMENTS = 40;

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
  "ic", // full IC (CPD events only)
  "ic_masked", // last 4 digits only
] as const;

export const SAMPLE_VALUES: Record<string, string> = {
  attendee_name: "Nur Aisyah binti Ahmad",
  event_name: "Sample Event 2026",
  date: "25 October 2026",
  location: "Putrajaya",
  host_name: "Your Organisation",
  certificate_id: "00000000-0000-4000-8000-000000000000",
  ic: "900101-14-1234",
  ic_masked: "******-**-1234",
};

export type TextElement = {
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  font: FontName;
  color: string;
  align: "left" | "center" | "right";
};
export type ImageElement = {
  type: "image";
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type QrElement = { type: "qr"; x: number; y: number; size: number; color: string };
export type DesignElement = TextElement | ImageElement | QrElement;

export type Layout = {
  orientation?: Orientation; // missing on older designs = landscape
  backgroundColor: string;
  backgroundAssetId: string | null;
  elements: DesignElement[];
};

export type Asset = {
  id: string;
  kind: "logo" | "background" | "signature" | "image";
  mime: string;
  size: number;
  width: number;
  height: number;
};

export const assetUrl = (id: string) => `/api/v1/admin/assets/${id}/file`;

export function blankLayout(orientation: Orientation = "landscape"): Layout {
  const page = pageSize(orientation);
  const margin = 60;
  const width = page.width - margin * 2;
  // Vertical positions as fractions of the page height, so both orientations look balanced
  const line = (
    text: string,
    yFraction: number,
    fontSize: number,
    font: FontName,
    color: string,
  ): TextElement => ({
    type: "text",
    text,
    x: margin,
    y: Math.round(page.height * yFraction),
    width,
    fontSize,
    font,
    color,
    align: "center",
  });

  const portrait = orientation === "portrait";
  return {
    orientation,
    backgroundColor: "#FFFFFF",
    backgroundAssetId: null,
    elements: [
      line("CERTIFICATE OF ATTENDANCE", 0.15, portrait ? 26 : 32, "Times-Bold", "#1F2937"),
      line("{{attendee_name}}", portrait ? 0.4 : 0.37, portrait ? 32 : 40, "Times-Bold", "#111827"),
      line("{{event_name}} · {{date}}", portrait ? 0.52 : 0.54, 18, "Helvetica", "#4B5563"),
    ],
  };
}

/** CSS equivalent of a PDF standard font, so the canvas matches the PDF closely. */
export function cssFont(font: FontName) {
  const family = font.startsWith("Times")
    ? '"Times New Roman", Times, serif'
    : font.startsWith("Courier")
      ? '"Courier New", Courier, monospace'
      : "Helvetica, Arial, sans-serif";
  return {
    family,
    weight: font.includes("Bold") ? 700 : 400,
    style: /Italic|Oblique/.test(font) ? "italic" : "normal",
  };
}

export const fillSample = (text: string) =>
  text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key) => SAMPLE_VALUES[key] ?? m);

// Hand-off from "Import PPTX" on the list page to the editor
export const importedDraft = $state<{
  value: { name: string; layout: Layout; warnings: string[] } | null;
}>({ value: null });

/** Reads an error message from a failed API response (Elysia returns plain text or JSON). */
export async function errorMessage(res: Response, fallback: string) {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return json.message || json.summary || fallback;
  } catch {
    return text || fallback;
  }
}
