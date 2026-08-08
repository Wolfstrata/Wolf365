import { describe, it, expect } from "vitest";
import {
  THEMES,
  THEME_COOKIE,
  nextTheme,
  parseTheme,
  themeActionLabel,
  themeAttribute,
  themeCookieString,
  themeLabel,
  type Theme,
} from "@/lib/theme";

describe("parseTheme", () => {
  it("accepts the three real values", () => {
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("normalises case and whitespace", () => {
    expect(parseTheme("  DARK ")).toBe("dark");
  });

  it("falls back to system for anything else", () => {
    // A cookie is user-editable and this runs in the root layout on every
    // request, so a junk value must not throw.
    for (const junk of ["", "  ", "blue", "true", "<script>", null, undefined]) {
      expect(parseTheme(junk), String(junk)).toBe("system");
    }
  });
});

describe("nextTheme", () => {
  it("cycles system → light → dark → system", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });

  it("returns to the start within one pass of every theme", () => {
    let theme: Theme = THEMES[0]!;
    for (let i = 0; i < THEMES.length; i += 1) theme = nextTheme(theme);
    expect(theme).toBe(THEMES[0]);
  });
});

describe("themeAttribute", () => {
  it("is null for system, so the media query stays in charge", () => {
    // The whole "follow the OS" behaviour depends on no attribute being present.
    expect(themeAttribute("system")).toBeNull();
  });

  it("is the theme name for an explicit choice", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });
});

describe("themeCookieString", () => {
  it("stores an explicit choice with a path and a long life", () => {
    const cookie = themeCookieString("dark");
    expect(cookie).toContain(`${THEME_COOKIE}=dark`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toMatch(/Max-Age=\d{7,}/);
  });

  it("deletes the cookie for system rather than storing the word", () => {
    const cookie = themeCookieString("system");
    expect(cookie).toContain(`${THEME_COOKIE}=;`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).not.toContain("system");
  });

  it("does not set Secure, so the toggle works on http local dev", () => {
    expect(themeCookieString("light")).not.toContain("Secure");
  });
});

describe("labels", () => {
  it("names every theme", () => {
    for (const theme of THEMES) expect(themeLabel(theme)).toBeTruthy();
  });

  it("says both where you are and where the press takes you", () => {
    expect(themeActionLabel("system")).toBe("Theme: System theme — switch to Light");
    expect(themeActionLabel("light")).toBe("Theme: Light — switch to Dark");
    expect(themeActionLabel("dark")).toBe("Theme: Dark — switch to System theme");
  });
});
