import "server-only";
import { resolveSso } from "@/lib/auth/sso";
import { safeErrorMessage } from "@/lib/redact";

/**
 * Minimal app-only Microsoft Graph client (boundary A of the M365 integration).
 *
 * Reuses the SAME Entra app registration as OIDC sign-in (`resolveSso`) — the
 * integration guide allows Graph application permissions and the OIDC redirect to
 * live on one app. Tokens are acquired via the OAuth2 client-credentials grant
 * for the `.default` scope, which resolves to whatever Graph *application*
 * permissions an admin has consented to (e.g. Mail.Read, Calendars.Read,
 * User.Read.All). No SDK dependency — plain fetch keeps the bundle light and
 * routes through the platform's normal egress.
 *
 * Everything here is server-only; the client secret is never logged or shipped.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}
let tokenCache: CachedToken | null = null;

/** Whether app-only Graph credentials are available (Entra SSO configured). */
export async function graphConfigured(): Promise<boolean> {
  const sso = await resolveSso();
  return Boolean(sso?.tenantId && sso?.clientId && sso?.clientSecret);
}

/**
 * Acquire (and cache) an app-only Graph access token. Returns null when Entra
 * isn't configured or the token request fails — callers degrade gracefully.
 */
export async function getGraphToken(): Promise<string | null> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

  const sso = await resolveSso();
  if (!sso?.tenantId || !sso.clientId || !sso.clientSecret) return null;

  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${sso.tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: sso.clientId,
          client_secret: sso.clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    tokenCache = {
      token: json.access_token,
      expiresAt: now + (json.expires_in ?? 3600) * 1000,
    };
    return tokenCache.token;
  } catch {
    return null;
  }
}

/** GET a Graph resource (path relative to /v1.0) with an app-only token. */
export async function graphGet<T>(
  token: string,
  pathAndQuery: string,
): Promise<T | null> {
  try {
    const url = pathAndQuery.startsWith("http")
      ? pathAndQuery
      : `${GRAPH_BASE}${pathAndQuery}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        // Enables advanced query where needed; harmless otherwise.
        ConsistencyLevel: "eventual",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Result of a Graph call that reports *why* it failed, unlike `graphGet` which
 * collapses every failure to null. SilverFang mail needs the reason so an admin
 * can see "insufficient privileges" rather than a silent no-op.
 */
export interface GraphResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  /** Redacted Graph error message, when the call failed. */
  error?: string;
}

async function graphRequest<T>(
  token: string,
  method: "GET" | "POST" | "PATCH",
  pathAndQuery: string,
  body?: unknown,
): Promise<GraphResult<T>> {
  const url = pathAndQuery.startsWith("http") ? pathAndQuery : `${GRAPH_BASE}${pathAndQuery}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: safeErrorMessage(text || res.statusText, 300) };
    }
    // sendMail and friends answer 202 with no body.
    if (res.status === 204 || res.headers.get("content-length") === "0") {
      return { ok: true, status: res.status };
    }
    const text = await res.text();
    if (!text) return { ok: true, status: res.status };
    return { ok: true, status: res.status, data: JSON.parse(text) as T };
  } catch (err) {
    return { ok: false, status: 0, error: safeErrorMessage(err, 300) };
  }
}

/** GET a Graph resource, reporting the failure reason. */
export function graphGetChecked<T>(token: string, pathAndQuery: string): Promise<GraphResult<T>> {
  return graphRequest<T>(token, "GET", pathAndQuery);
}

/** POST to Graph (e.g. /users/{mailbox}/sendMail). */
export function graphPost<T>(
  token: string,
  pathAndQuery: string,
  body: unknown,
): Promise<GraphResult<T>> {
  return graphRequest<T>(token, "POST", pathAndQuery, body);
}

/** PATCH a Graph resource (e.g. marking a message read). */
export function graphPatch<T>(
  token: string,
  pathAndQuery: string,
  body: unknown,
): Promise<GraphResult<T>> {
  return graphRequest<T>(token, "PATCH", pathAndQuery, body);
}

/** The domain part of an email address, lowercased; null when unparseable. */
export function domainOf(email: string | null | undefined): string | null {
  const at = (email ?? "").trim().toLowerCase().split("@");
  return at.length === 2 && at[1] ? at[1] : null;
}
