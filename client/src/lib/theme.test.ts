import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { initialTheme, saveTheme } from "./theme.js";

const preferLight = (light: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: light && query.includes("light") }));

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("initialTheme", () => {
  test("uses the saved choice over the OS preference", () => {
    preferLight(true);
    localStorage.setItem("ezcert-theme", "dark");
    expect(initialTheme()).toBe("dark");

    preferLight(false);
    localStorage.setItem("ezcert-theme", "light");
    expect(initialTheme()).toBe("light");
  });

  test("follows the OS preference when nothing is saved", () => {
    preferLight(true);
    expect(initialTheme()).toBe("light");
    preferLight(false);
    expect(initialTheme()).toBe("dark");
  });

  test("ignores a corrupt saved value", () => {
    preferLight(false);
    localStorage.setItem("ezcert-theme", "purple");
    expect(initialTheme()).toBe("dark");
  });

  test("still works when storage is blocked", () => {
    preferLight(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(initialTheme()).toBe("light");
  });
});

describe("saveTheme", () => {
  test("persists the choice for next time", () => {
    saveTheme("light");
    expect(localStorage.getItem("ezcert-theme")).toBe("light");
  });

  test("never throws when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveTheme("dark")).not.toThrow();
  });
});
