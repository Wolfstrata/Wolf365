/**
 * Light / dark / follow-the-system.
 *
 * The app has always followed `prefers-color-scheme` and had no way to override
 * it. This adds the override, and does it with a **cookie read server-side**
 * rather than the usual localStorage-plus-inline-script trick.
 *
 * That is not a stylistic preference. The CSP sets `script-src 'nonce-…'
 * 'strict-dynamic'`, so the blocking inline script that normally prevents a
 * flash-of-wrong-theme is not available to us and must not be reintroduced.
 * A cookie is readable in the root layout, so `<html>` ships with the right
 * `data-theme` already on it — no flash, and no script needed at all.
 *
 * `system` is represented by the **absence** of the attribute, which is what lets
 * the existing `prefers-color-scheme` block keep working untouched.
 */

export const THEME_COOKIE = "wolf365-theme";

/** A year: long enough that nobody re-picks, short enough to be a preference. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Read a stored value, defaulting to `system`.
 *
 * Tolerant on purpose: a cookie is user-editable, and an unrecognised value
 * should fall back to following the OS rather than throwing on every request in
 * the root layout.
 */
export function parseTheme(value: string | null | undefined): Theme {
  const candidate = (value ?? "").trim().toLowerCase();
  return (THEMES as readonly string[]).includes(candidate) ? (candidate as Theme) : "system";
}

/**
 * The next theme when the button is pressed.
 *
 * Cycles system → light → dark → system. Starting from `system` and passing
 * through both explicit states means one control covers every option, and the
 * cycle returns to "just do what my laptop does" rather than trapping you in an
 * explicit choice.
 */
export function nextTheme(current: Theme): Theme {
  const i = THEMES.indexOf(current);
  return THEMES[(i + 1) % THEMES.length]!;
}

/**
 * The `data-theme` attribute value, or null for `system`.
 *
 * Null is meaningful: no attribute is what hands control back to the
 * `prefers-color-scheme` media query.
 */
export function themeAttribute(theme: Theme): string | null {
  return theme === "system" ? null : theme;
}

const LABELS: Record<Theme, string> = {
  system: "System theme",
  light: "Light",
  dark: "Dark",
};

export function themeLabel(theme: Theme): string {
  return LABELS[theme];
}

/** What pressing the button will do, for its tooltip and screen-reader name. */
export function themeActionLabel(current: Theme): string {
  return `Theme: ${themeLabel(current)} — switch to ${themeLabel(nextTheme(current))}`;
}

/**
 * The `Set-Cookie`-style string the client writes.
 *
 * Built here rather than inline in the component so the flags are stated once and
 * tested. `SameSite=Lax` and no `Secure` flag on purpose: this is a display
 * preference, it carries nothing sensitive, and forcing `Secure` would silently
 * break the toggle on plain-HTTP local dev.
 */
export function themeCookieString(theme: Theme): string {
  if (theme === "system") {
    // Delete rather than store "system": an absent cookie and a "system" cookie
    // mean the same thing, and one representation is easier to reason about.
    return `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}
