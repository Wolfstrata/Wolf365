import type { ConnectorType } from "@prisma/client";
import { ProxyAgent } from "undici";
import { writeDebugLog } from "@/lib/debug-log";
import { safeUrl } from "@/lib/redact";

/**
 * Optional static-IP egress proxy. When a proxy URL is set, every connector API
 * call is dispatched through it so the request originates from a fixed IP
 * (required by, e.g., QuickBooks Online production IP allowlisting). Accepts the
 * generic OUTBOUND_PROXY_URL or QuotaGuard's default QUOTAGUARDSTATIC_URL.
 * Created once per process.
 */
const proxyUrl =
  process.env.OUTBOUND_PROXY_URL || process.env.QUOTAGUARDSTATIC_URL;
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

/**
 * Shared HTTP client for connectors.
 *
 * Responsibilities:
 * - Real fetch with timeout via AbortController (no fake responses ever).
 * - Bounded retry with exponential backoff for transient failures (429, 5xx).
 * - Honors Retry-After when present.
 * - Writes a redacted debug-log entry per attempt (no secrets/headers/bodies).
 *
 * Callers pass headers (including Authorization) but those headers are NEVER
 * logged — only the method, path, status, timing, and correlation id are.
 */
export interface ConnectorRequestOptions {
  connectorType: ConnectorType;
  connectorId?: string | null;
  environment?: string | null;
  /** Logical action name for the debug log, e.g. "sync_customers". */
  action: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Per-attempt timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Header name carrying a correlation/request id, if the API returns one. */
  correlationHeader?: string;
}

export interface ConnectorResponse {
  ok: boolean;
  status: number;
  body: string;
  headers: Headers;
  durationMs: number;
  attempts: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function connectorFetch(
  url: string,
  opts: ConnectorRequestOptions,
): Promise<ConnectorResponse> {
  const method = opts.method ?? "GET";
  const maxAttempts = opts.maxAttempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const start = Date.now();

  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    const attemptStart = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: opts.headers,
        body: opts.body,
        signal: controller.signal,
        // Connectors talk to external HTTPS APIs; never cache.
        cache: "no-store",
        // Route through the static-IP proxy when configured (undici dispatcher).
        ...(proxyAgent ? { dispatcher: proxyAgent } : {}),
      } as RequestInit & { dispatcher?: unknown });
      clearTimeout(timer);

      const text = await res.text();
      const durationMs = Date.now() - attemptStart;
      const correlationId = opts.correlationHeader
        ? res.headers.get(opts.correlationHeader)
        : null;
      const rateLimited = res.status === 429;

      const retryable = RETRYABLE_STATUS.has(res.status);
      const willRetry = retryable && attempt < maxAttempts;

      await writeDebugLog({
        type: opts.connectorType,
        connectorId: opts.connectorId,
        environment: opts.environment,
        action: opts.action,
        endpoint: safeUrl(url),
        httpMethod: method,
        httpStatus: res.status,
        durationMs,
        correlationId,
        retryAttempts: attempt - 1,
        rateLimited,
        outcome: res.ok ? "success" : "failure",
        error: res.ok ? undefined : `HTTP ${res.status}`,
      });

      if (!willRetry) {
        return {
          ok: res.ok,
          status: res.status,
          body: text,
          headers: res.headers,
          durationMs: Date.now() - start,
          attempts: attempt,
        };
      }

      await backoff(attempt, res.headers.get("retry-after"));
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      await writeDebugLog({
        type: opts.connectorType,
        connectorId: opts.connectorId,
        environment: opts.environment,
        action: opts.action,
        endpoint: safeUrl(url),
        httpMethod: method,
        durationMs: Date.now() - attemptStart,
        retryAttempts: attempt - 1,
        outcome: "failure",
        error: err,
      });
      if (attempt >= maxAttempts) break;
      await backoff(attempt, null);
    }
  }

  throw new ConnectorHttpError(
    `Request to ${safeUrl(url)} failed after ${maxAttempts} attempt(s)`,
    { cause: lastError },
  );
}

export class ConnectorHttpError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConnectorHttpError";
  }
}

/** Exponential backoff with jitter; respects an integer Retry-After (seconds). */
async function backoff(attempt: number, retryAfter: string | null) {
  let delayMs: number;
  const retryAfterSec = retryAfter ? Number(retryAfter) : NaN;
  if (!Number.isNaN(retryAfterSec) && retryAfterSec >= 0) {
    delayMs = retryAfterSec * 1000;
  } else {
    delayMs = Math.min(2 ** (attempt - 1) * 1000, 16_000);
  }
  const jitter = Math.floor(Math.random() * 250);
  await new Promise((r) => setTimeout(r, delayMs + jitter));
}
