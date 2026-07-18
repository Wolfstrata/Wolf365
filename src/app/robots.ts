import type { MetadataRoute } from "next";

/**
 * robots.txt for an internal, authenticated application: disallow all crawling.
 * Serving it from a Next route (rather than a static/CDN file) means it carries
 * the app's own same-origin security headers instead of CDN CORS defaults.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
