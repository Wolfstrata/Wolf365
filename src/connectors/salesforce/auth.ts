import { ConnectorHttpError, connectorFetch } from "@/connectors/http";

/**
 * Salesforce authentication via the OAuth 2.0 Client Credentials flow.
 *
 * Setup (Salesforce side): create a Connected App with OAuth enabled, the
 * "Manage user data via APIs (api)" scope, the Client Credentials Flow enabled,
 * and a "Run As" user set in the app's OAuth policies. The Consumer Key /
 * Consumer Secret become the client id / secret here.
 *
 * HONESTY: we never hardcode an instance. The admin supplies their My Domain
 * login URL; we POST a REAL client-credentials grant to its /services/oauth2/
 * token endpoint. Salesforce returns both an access token and the `instance_url`
 * to use for subsequent API calls. Wrong details surface the real error — we
 * never fake success.
 */

export interface SalesforceSecrets {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number; // epoch ms
  /** Instance URL returned by the token endpoint (where the API lives). */
  instanceUrl?: string;
}

export interface SalesforceConfig {
  /** My Domain login URL, e.g. https://acme.my.salesforce.com */
  loginUrl?: string;
  apiVersion?: string;
  targetLine?: string;
  soqlFilter?: string;
  amountField?: string;
  amountBasis?: "MONTHLY" | "ANNUAL" | "TOTAL_CONTRACT";
  marginField?: string;
  termField?: string;
  defaultTermYears?: string;
  defaultOwnerEmail?: string;
}

interface TokenResponse {
  access_token: string;
  instance_url?: string;
  token_type?: string;
  issued_at?: string;
}

/** Normalize a login URL to its origin (drops any trailing path/slash). */
export function loginOrigin(loginUrl: string): string {
  return new URL(loginUrl).origin;
}

/** Extract Salesforce's OAuth error + description from an error body (safe). */
function parseOAuthError(body: string): string | null {
  try {
    const j = JSON.parse(body) as { error?: string; error_description?: string };
    const parts = [j.error, j.error_description].filter(Boolean);
    return parts.length ? parts.join(" — ") : null;
  } catch {
    // Non-JSON (e.g. HTML redirect page) — surface a short, safe snippet.
    const snippet = body.replace(/\s+/g, " ").trim().slice(0, 120);
    return snippet || null;
  }
}

export interface SalesforceAuth {
  accessToken: string;
  instanceUrl: string;
}

/**
 * Obtain a valid Salesforce access token + instance URL via client-credentials,
 * refreshing when missing/expired. Salesforce client-credentials tokens don't
 * report expires_in, so we cache for a conservative window — but org session
 * policies can expire them sooner, so callers also retry once on a 401 with
 * `forceRefresh: true`.
 */
export async function getSalesforceAuth(
  config: SalesforceConfig,
  secrets: SalesforceSecrets,
  save: (next: SalesforceSecrets) => Promise<void>,
  forceRefresh = false,
): Promise<SalesforceAuth> {
  if (!config.loginUrl) {
    throw new Error(
      "Salesforce My Domain login URL is not configured (e.g. https://yourco.my.salesforce.com)",
    );
  }
  if (!secrets.clientId || !secrets.clientSecret) {
    throw new Error("Salesforce Consumer Key / Secret are not configured");
  }

  const skewMs = 120_000;
  if (
    !forceRefresh &&
    secrets.accessToken &&
    secrets.instanceUrl &&
    secrets.accessTokenExpiresAt &&
    secrets.accessTokenExpiresAt - skewMs > Date.now()
  ) {
    return { accessToken: secrets.accessToken, instanceUrl: secrets.instanceUrl };
  }

  const tokenUrl = `${loginOrigin(config.loginUrl)}/services/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: secrets.clientId,
    client_secret: secrets.clientSecret,
  });

  const res = await connectorFetch(tokenUrl, {
    connectorType: "SALESFORCE",
    action: "oauth_token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    // Surface Salesforce's OAuth error/description — these are diagnostic and
    // contain no secrets (we never echo client_id/secret). They pinpoint the
    // cause: invalid_client (bad key/secret), unsupported_grant_type (Client
    // Credentials Flow not enabled), invalid_grant (Run-As user missing/inactive
    // or lacks API Enabled), etc.
    const detail = parseOAuthError(res.body);
    throw new ConnectorHttpError(
      `Salesforce token request failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}. ` +
        "Verify the My Domain URL, Consumer Key/Secret, and that the Client Credentials Flow + a Run-As user are configured on the connected app.",
    );
  }
  const token = JSON.parse(res.body) as TokenResponse;
  if (!token.access_token || !token.instance_url) {
    throw new ConnectorHttpError(
      "Salesforce token response did not include an access_token / instance_url",
    );
  }

  const next: SalesforceSecrets = {
    ...secrets,
    accessToken: token.access_token,
    instanceUrl: token.instance_url,
    // Client-credentials tokens are short-lived and the lifetime isn't reported.
    // Cache optimistically (15m); a 401 mid-operation forces a refresh + retry,
    // so correctness doesn't depend on this window matching the org's policy.
    accessTokenExpiresAt: Date.now() + 900_000,
  };
  await save(next);
  return { accessToken: token.access_token, instanceUrl: token.instance_url };
}
