/**
 * Redaction utilities shared by the debug logger and any code that might emit
 * connector data to logs.
 *
 * The default-deny philosophy: we explicitly strip known-sensitive keys and
 * anything that looks like a token/secret, then truncate. It is always safer to
 * over-redact a log line than to leak a credential.
 */

const SENSITIVE_KEY_PATTERN =
  /(secret|password|passwd|token|authorization|auth|apikey|api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|id[_-]?token|code|bearer|x-api-key|cookie|set-cookie)/i;

const REDACTED = "[REDACTED]";

/** Strip the query string and fragment from a URL/path, keeping only the path. */
export function safeEndpoint(urlOrPath: string): string {
  try {
    // Handles absolute URLs.
    const u = new URL(urlOrPath);
    return u.pathname;
  } catch {
    // Relative path — drop any query/fragment manually.
    return urlOrPath.split("?")[0]!.split("#")[0]!;
  }
}

/**
 * Like {@link safeEndpoint} but keeps the scheme + host so the target
 * environment is visible in debug logs (e.g. api.ca vs api-uat.ca). The query
 * string is still stripped. The host is not secret.
 */
export function safeUrl(urlOrPath: string): string {
  try {
    const u = new URL(urlOrPath);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return urlOrPath.split("?")[0]!.split("#")[0]!;
  }
}

/**
 * Recursively redact sensitive keys from an arbitrary object so it is safe to
 * persist in a debug log. Returns a new object; does not mutate the input.
 */
export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactObject(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k)
        ? REDACTED
        : redactObject(v, depth + 1);
    }
    return out;
  }
  return REDACTED;
}

/** Produce a safe, redacted, length-limited error message string. */
export function safeErrorMessage(err: unknown, maxLen = 500): string {
  let msg: string;
  if (err instanceof Error) msg = err.message;
  else if (typeof err === "string") msg = err;
  else msg = "Unknown error";
  // Defensively strip anything resembling a bearer token from the message.
  msg = msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer " + REDACTED);
  return truncate(msg, maxLen);
}

function truncate(s: string, maxLen = 2000): string {
  return s.length > maxLen ? `${s.slice(0, maxLen)}…[truncated]` : s;
}
