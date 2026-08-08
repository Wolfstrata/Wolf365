import type { Metadata } from "next";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme, themeAttribute } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wolf365",
  description:
    "Secure Microsoft 365 billing reconciliation and invoicing staging for MSPs.",
  robots: { index: false, follow: false },
};

/**
 * Reads the theme cookie so `<html>` is rendered with `data-theme` already set.
 *
 * This is what avoids a flash of the wrong theme without an inline script — the
 * CSP is `script-src 'nonce-…' 'strict-dynamic'`, so the usual blocking snippet
 * is unavailable and must not be reintroduced. Doing it server-side is both
 * cheaper and safer.
 *
 * No cookie means no attribute, which hands the decision back to
 * `prefers-color-scheme`.
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const attr = themeAttribute(theme);

  return (
    <html lang="en" {...(attr ? { "data-theme": attr } : {})}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
