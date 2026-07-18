import type { NextConfig } from "next";

/**
 * Security-focused Next.js configuration.
 *
 * Security headers are applied globally. HSTS is only meaningful over HTTPS
 * (Vercel terminates TLS), and is safe to send everywhere because browsers
 * ignore it on plain HTTP.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Cross-origin isolation: keep this app's browsing context and its resources
  // same-origin. The app authenticates via full-page OAuth redirects (Entra SSO,
  // QBO callback), never popups, so `same-origin` here is safe and blocks other
  // sites from opening/reading our windows or loading our resources cross-origin.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // NOTE: Content-Security-Policy is set per-request in middleware.ts so it can
  // include a unique nonce (no 'unsafe-inline' for scripts).
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Connector secrets must never leak to the client bundle. Server-only
  // packages stay on the server; we never import them from client components.
  serverExternalPackages: ["@prisma/client"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
