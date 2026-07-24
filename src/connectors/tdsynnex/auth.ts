import { ConnectorHttpError, connectorFetch } from "@/connectors/http";

/**
 * TD SYNNEX StreamOne Stellr authentication.
 *
 * Stellr uses OAuth 2.0. Resellers obtain a Client ID/Secret from the Stellr
 * Developer Portal (My Account → Client Credentials), choosing Sandbox or
 * Production. Access tokens are short-lived (~2h).
 *
 * IMPORTANT (honesty rule): the precise token endpoint and API base URL are
 * region/environment specific and are documented in the partner-gated Stellr
 * API reference. Rather than hardcode an unverified endpoint, we require the
 * admin to supply the Token URL and API Base URL from their portal. We perform
 * a REAL client-credentials request against the supplied Token URL — if those
 * details are wrong, the real API error surfaces; we never fake success.
 */

export interface StellrSecrets {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number; // epoch ms
}

export interface StellrConfig {
  environment?: "sandbox" | "production";
  region?: string;
  apiBaseUrl?: string;
  tokenUrl?: string;
  /** Optional scope if the tenant's Stellr app requires one. */
  scope?: string;
  /** Reseller account id used to scope account-specific endpoints. */
  accountId?: string;
  /** Documented resource paths (admin-supplied from the API reference). */
  customersPath?: string;
  subscriptionsPath?: string;
  /**
   * Documented path for `listSubscriptionChangeLogs` (admin-supplied from the
   * Stellr API reference). Uses {customerNo} and {contractNo} placeholders, e.g.
   * `/reseller/v1/customers/{customerNo}/subscriptions/changelogs?contractNo={contractNo}`.
   * Used to discover the exact date/quantity of mid-month seat additions on a
   * co-terminous subscription (which fold into the base line, so their add date
   * isn't visible on the subscription payload itself).
   */
  changeLogsPath?: string;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/**
 * Obtain a valid Stellr access token via client-credentials, refreshing when
 * missing/expired. Persists the cached token via `save`.
 */
export async function getStellrAccessToken(
  config: StellrConfig,
  secrets: StellrSecrets,
  save: (next: StellrSecrets) => Promise<void>,
): Promise<string> {
  if (!config.tokenUrl) {
    throw new Error(
      "TD SYNNEX Token URL is not configured (see Stellr Developer Portal)",
    );
  }
  if (!secrets.clientId || !secrets.clientSecret) {
    throw new Error("TD SYNNEX client credentials are not configured");
  }

  const skewMs = 120_000;
  if (
    secrets.accessToken &&
    secrets.accessTokenExpiresAt &&
    secrets.accessTokenExpiresAt - skewMs > Date.now()
  ) {
    return secrets.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: secrets.clientId,
    client_secret: secrets.clientSecret,
  });
  if (config.scope) body.set("scope", config.scope);

  const res = await connectorFetch(config.tokenUrl, {
    connectorType: "TD_SYNNEX_STELLR",
    environment: config.environment ?? config.region ?? null,
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
      `TD SYNNEX token request failed (HTTP ${res.status})`,
    );
  }
  const token = JSON.parse(res.body) as TokenResponse;
  if (!token.access_token) {
    throw new ConnectorHttpError(
      "TD SYNNEX token response did not include an access_token",
    );
  }
  const next: StellrSecrets = {
    ...secrets,
    accessToken: token.access_token,
    accessTokenExpiresAt:
      Date.now() + (token.expires_in ? token.expires_in * 1000 : 3600_000),
  };
  await save(next);
  return token.access_token;
}
