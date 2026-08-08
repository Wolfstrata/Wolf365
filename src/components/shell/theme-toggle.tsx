"use client";

import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  nextTheme,
  themeActionLabel,
  themeAttribute,
  themeCookieString,
  themeLabel,
  type Theme,
} from "@/lib/theme";

const ICONS: Record<Theme, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/**
 * Light / dark / system, as one cycling button in the sidebar footer.
 *
 * Applies the change by writing `data-theme` on `<html>` directly, so it is
 * instant and needs no round trip. The cookie is written at the same time purely
 * so the *next* page load renders correctly server-side — the DOM write is what
 * you see, the cookie is what stops it flashing next time.
 *
 * `initial` comes from the server, which has already read the cookie. Without it
 * the button would start on "system" and disagree with the page it is sitting on.
 */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const Icon = ICONS[theme];

  function apply(next: Theme) {
    const attr = themeAttribute(next);
    if (attr) document.documentElement.dataset.theme = attr;
    // Removed, not set to "system": the absence of the attribute is what lets the
    // prefers-color-scheme media query take over again.
    else delete document.documentElement.dataset.theme;

    try {
      document.cookie = themeCookieString(next);
    } catch {
      // A blocked cookie only costs persistence — the theme still changed, so
      // failing loudly here would be worse than the page simply not remembering.
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={() => apply(nextTheme(theme))}
      title={themeActionLabel(theme)}
      aria-label={themeActionLabel(theme)}
      className="inline-flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{themeLabel(theme)}</span>
    </button>
  );
}
