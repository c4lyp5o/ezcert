export type Theme = "light" | "dark";

// Keep in sync with the pre-paint script in src/app.html.
const THEME_KEY = "ezcert-theme";

/** Saved choice, else the OS preference; dark when neither says light. */
export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // storage blocked (private mode etc.): fall through to the OS preference
  }
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // not persisted; the toggle still works for this page view
  }
}
