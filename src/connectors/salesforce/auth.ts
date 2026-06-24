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

export interface SalesforceAuth {
  accessToken: string;
  instanceUrl: string;
}

/**
 * Obtain a valid Salesforce access token + instance URL via client-credentials,
 * refreshing when missing/expired. Salesforce client-credentials tokens don't
 * report expires_in, so we cache for a conservative window and re-auth after.
 */
export async function getSalesforceAuth(
  config: SalesforceConfig,
  secrets: SalesforceSecrets,
  save: (next: SalesforceSecrets) => Promise<void>,
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
    throw new ConnectorHttpError(
      `Salesforce token request failed (HTTP ${res.status}). Verify the My Domain URL, ` +
        "Consumer Key/Secret, and that the Client Credentials Flow + a Run-As user are configured.",
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
    // Client-credentials tokens are short-lived; cache conservatively (1h).
    accessTokenExpiresAt: Date.now() + 3_600_000,
  };
  await save(next);
  return { accessToken: token.access_token, instanceUrl: token.instance_url };
}
