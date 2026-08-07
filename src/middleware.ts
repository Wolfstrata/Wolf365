import { NextRequest, NextResponse } from "next/server";
import { CRAWLER_REFUSAL_BODY, isCrawler, ROBOTS_TAG } from "@/lib/bots";

/**
 * Per-request Content-Security-Policy with a unique nonce.
 *
 * Using a nonce + `strict-dynamic` removes `'unsafe-inline'` from script-src:
 * Next.js automatically stamps the nonce onto the scripts it emits (it reads it
 * from the CSP header we set on the request), and `strict-dynamic` lets those
 * trusted scripts load the rest of the bundle. Styles keep `'unsafe-inline'`
 * (Tailwind/Next inject <style> tags; style injection is not a script-exec risk).
 *
 * It also keeps the app out of search engines and AI corpora: known crawlers are
 * refused with a 403 before anything renders, and every response carries an
 * X-Robots-Tag. See src/lib/bots.ts for why that is a curated list rather than a
 * match on "bot".
 *
 * This middleware only manipulates headers — no DB/auth — so it runs safely on
 * the edge runtime. It also forwards the request path, because the authenticated
 * layout needs it to enforce workspace isolation and a Next.js layout is not told
 * which route it is rendering. The enforcement itself stays in the layout, where
 * the session and the role are available.
 */
export function middleware(request: NextRequest) {
  // Refused before anything else runs. A crawler gets no page, no redirect to the
  // login screen, and nothing that confirms what this application is.
  if (isCrawler(request.headers.get("user-agent"))) {
    return new NextResponse(CRAWLER_REFUSAL_BODY, {
      status: 403,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": ROBOTS_TAG,
        // Nothing about a refusal is worth caching, and a cached 403 served to a
        // real user would look like a broken app.
        "Cache-Control": "no-store",
      },
    });
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  // Pass the nonce + CSP to Next on the request so it can nonce its scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  // Read by the (app) layout to resolve the current workspace. Set from the URL
  // on every request, so a client cannot spoof it to cross a border.
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  // On every response, not just HTML pages. Unlike a <meta> tag this also covers
  // JSON, redirects and errors, and it is the directive the major engines actually
  // obey — robots.txt is only a request.
  response.headers.set("X-Robots-Tag", ROBOTS_TAG);
  return response;
}

export const config = {
  matcher: [
    // Apply to pages; skip Next static assets, API routes, and the favicon.
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
