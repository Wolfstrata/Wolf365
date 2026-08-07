import type { MetadataRoute } from "next";

/**
 * robots.txt for an internal, authenticated application: nothing is crawlable.
 *
 * Served from a Next route rather than a static file so it carries the app's own
 * same-origin security headers instead of CDN defaults.
 *
 * This is the politeness layer only — robots.txt is a request, honoured at the
 * crawler's discretion. The directives that actually bind are the X-Robots-Tag
 * header on every response and the outright 403 for known crawlers, both in
 * src/middleware.ts. Do not treat this file as the protection.
 *
 * Deliberately no `sitemap` entry, and no `allow` exceptions: every path here is
 * behind authentication, so there is nothing a crawler has any business fetching.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", disallow: "/" },
      // Named explicitly as well as covered by the wildcard. Some crawlers only
      // read the group that names them and ignore "*" once they find one.
      {
        userAgent: [
          "GPTBot",
          "OAI-SearchBot",
          "ChatGPT-User",
          "ClaudeBot",
          "Claude-Web",
          "anthropic-ai",
          "PerplexityBot",
          "CCBot",
          "Google-Extended",
          "meta-externalagent",
          "Bytespider",
          "Amazonbot",
          "Applebot-Extended",
        ],
        disallow: "/",
      },
    ],
  };
}
