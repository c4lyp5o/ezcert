import { describe, expect, test } from "vitest";

import {
  FONTS,
  MAX_ELEMENTS,
  PLACEHOLDERS,
  SAMPLE_VALUES,
  assetUrl,
  blankLayout,
  cssFont,
  errorMessage,
  fillSample,
  pageSize,
} from "./designs.svelte.js";

// The server owns the rules; the client mirrors them for the designer. The server validates
// everything again, but a drift here means the editor offers things the API then rejects.
import * as server from "../../../src/designs/layout";

describe("client mirrors the server's design rules", () => {
  test("same placeholders, in the same order", () => {
    expect([...PLACEHOLDERS]).toEqual([...server.PLACEHOLDERS]);
  });

  test("same fonts", () => {
    expect([...FONTS]).toEqual([...server.FONTS]);
  });

  test("same sample values", () => {
    expect(SAMPLE_VALUES).toEqual(server.SAMPLE_VALUES);
  });

  test("same page sizes for both orientations", () => {
    for (const orientation of ["landscape", "portrait"] as const) {
      expect(pageSize(orientation)).toEqual(server.pageSize(orientation));
    }
  });

  test("the starter layout passes the server's bounds check in both orientations", () => {
    for (const orientation of ["landscape", "portrait"] as const) {
      expect(server.layoutBoundsError(blankLayout(orientation) as never)).toBeNull();
    }
  });

  test("every sample value has a placeholder and vice versa", () => {
    expect(Object.keys(SAMPLE_VALUES).sort()).toEqual([...PLACEHOLDERS].sort());
  });
});

describe("pageSize", () => {
  test("defaults to landscape A4", () => {
    expect(pageSize()).toEqual({ width: 841.89, height: 595.28 });
  });

  test("portrait swaps the sides", () => {
    expect(pageSize("portrait")).toEqual({ width: 595.28, height: 841.89 });
  });
});

describe("blankLayout", () => {
  test("keeps the orientation and starts with three centred text lines", () => {
    const layout = blankLayout("portrait");
    expect(layout.orientation).toBe("portrait");
    expect(layout.backgroundAssetId).toBeNull();
    expect(layout.elements).toHaveLength(3);
    expect(layout.elements.every((e) => e.type === "text" && e.align === "center")).toBe(true);
    expect(layout.elements.length).toBeLessThan(MAX_ELEMENTS);
  });

  test("defaults to landscape and puts the attendee name placeholder in", () => {
    const layout = blankLayout();
    expect(layout.orientation).toBe("landscape");
    expect(JSON.stringify(layout.elements)).toContain("{{attendee_name}}");
  });

  test("every line sits inside the page, with margins", () => {
    for (const orientation of ["landscape", "portrait"] as const) {
      const page = pageSize(orientation);
      for (const el of blankLayout(orientation).elements) {
        if (el.type !== "text") continue;
        expect(el.x).toBeGreaterThan(0);
        expect(el.x + el.width).toBeLessThan(page.width);
        expect(el.y).toBeLessThan(page.height);
      }
    }
  });
});

describe("cssFont", () => {
  test.each([
    ["Helvetica", "Helvetica, Arial, sans-serif", 400, "normal"],
    ["Helvetica-BoldOblique", "Helvetica, Arial, sans-serif", 700, "italic"],
    ["Times-Italic", '"Times New Roman", Times, serif', 400, "italic"],
    ["Times-Bold", '"Times New Roman", Times, serif', 700, "normal"],
    ["Courier-Oblique", '"Courier New", Courier, monospace', 400, "italic"],
  ] as const)("%s", (font, family, weight, style) => {
    expect(cssFont(font)).toEqual({ family, weight, style });
  });
});

describe("fillSample", () => {
  test("replaces known placeholders, tolerating spaces", () => {
    expect(fillSample("{{ attendee_name }} at {{event_name}}")).toBe(
      "Nur Aisyah binti Ahmad at Sample Event 2026",
    );
  });

  test("leaves unknown placeholders and plain text alone", () => {
    expect(fillSample("{{nope}} plain")).toBe("{{nope}} plain");
  });

  test("fills the IC placeholders", () => {
    expect(fillSample("{{ic}} / {{ic_masked}}")).toBe("900101-14-1234 / ******-**-1234");
  });
});

describe("assetUrl", () => {
  test("points at the owner-only file route", () => {
    expect(assetUrl("abc")).toBe("/api/v1/admin/assets/abc/file");
  });
});

describe("errorMessage", () => {
  const response = (body: string) => new Response(body, { status: 422 });

  test("prefers a JSON message, then a summary", async () => {
    expect(await errorMessage(response(JSON.stringify({ message: "Too big" })), "fallback")).toBe("Too big");
    expect(await errorMessage(response(JSON.stringify({ summary: "Bad field" })), "fallback")).toBe("Bad field");
  });

  test("returns plain-text bodies as they are", async () => {
    expect(await errorMessage(response("Nope"), "fallback")).toBe("Nope");
  });

  test("falls back when the body is empty or has no message", async () => {
    expect(await errorMessage(response(""), "fallback")).toBe("fallback");
    expect(await errorMessage(response("{}"), "fallback")).toBe("fallback");
  });
});
