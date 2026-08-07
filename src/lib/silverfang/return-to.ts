/**
 * "Take me back where I came from" — safely.
 *
 * Drilling into something and saving should close that screen and return you to
 * the list you started from, not dump you on a default page. That means carrying
 * the origin through the form, and a caller-supplied redirect target is an
 * open-redirect waiting to happen: `?returnTo=https://evil.example` on a link that
 * looks like ours is a convincing phishing hop.
 *
 * So nothing is trusted. A target must be a site-relative path inside a known
 * SilverFang area, or it is discarded in favour of the caller's own default.
 *
 * Pure and tested, because the failure mode is a security bug rather than a
 * cosmetic one.
 */

/** Path prefixes a return target may point at. */
const ALLOWED_PREFIXES = ["/silverfang", "/silverfang-billing"];

/**
 * A safe return target, or null when there is none worth honouring.
 *
 * Rejects, deliberately:
 *  - anything not starting with a single "/" — absolute URLs and bare words
 *  - "//host" protocol-relative URLs, which browsers treat as absolute
 *  - backslashes, which some browsers normalise to "/" and which would smuggle
 *    "/\evil.example" past a naive check
 *  - control characters, including the newline that would let a target be split
 *    across a header
 *  - any path outside the allowed areas
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw === "") return null;
  if (raw.includes("\\")) return null;
  // Control characters, including the newline that would let a target be split
  // across a header.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;

  // Compare the path alone; a query string or fragment is fine to keep, and is
  // often the point (returning to a filtered list).
  const path = raw.split(/[?#]/)[0] ?? "";
  const allowed = ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  return allowed ? raw : null;
}

/** The safe target, else the caller's default. Never returns null. */
export function returnToOr(value: string | null | undefined, fallback: string): string {
  return safeReturnTo(value) ?? fallback;
}

/**
 * Append a return target to a link, so the screen it opens knows where back is.
 *
 * `from` is the path to come back to — usually the page building the link.
 */
export function withReturnTo(href: string, from: string | null | undefined): string {
  const safe = safeReturnTo(from);
  if (!safe) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}returnTo=${encodeURIComponent(safe)}`;
}

/** The query-string key, so the name is not spelled by hand in a dozen places. */
export const RETURN_TO_KEY = "returnTo";
