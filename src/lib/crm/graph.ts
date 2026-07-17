import "server-only";
import { resolveSso } from "@/lib/auth/sso";

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

/** The domain part of an email address, lowercased; null when unparseable. */
export function domainOf(email: string | null | undefined): string | null {
  const at = (email ?? "").trim().toLowerCase().split("@");
  return at.length === 2 && at[1] ? at[1] : null;
}
