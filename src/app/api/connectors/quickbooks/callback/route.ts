import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptJson, encryptJson, safeEqual } from "@/lib/crypto";
import { getEnvSecrets, setEnvSecrets } from "@/lib/connectors/secrets";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";
import {
  exchangeCodeForTokens,
  type QboSecrets,
} from "@/connectors/quickbooks/oauth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "qbo_oauth_state";

/** Helper: bounce back to the connector page with a status message. */
function redirectToConnector(origin: string, status: string): NextResponse {
  const url = new URL("/admin/connectors/QUICKBOOKS_ONLINE", origin);
  url.searchParams.set("qbo", status);
  return NextResponse.redirect(url);
}

/**
 * QuickBooks OAuth callback. Validates the CSRF state, exchanges the code for
 * tokens, and persists realmId + encrypted refresh/access tokens into the
 * connector's secret bag. Never logs the code or tokens.
 */
export async function GET(request: Request) {
  const user = await requirePermission("connectors:configure");
  const origin = new URL(request.url).origin;
  const params = new URL(request.url).searchParams;

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value ?? "";
  cookieStore.delete(STATE_COOKIE);

  const state = params.get("state") ?? "";
  const code = params.get("code");
  const realmId = params.get("realmId");

  if (!expectedState || !safeEqual(state, expectedState)) {
    return redirectToConnector(origin, "state_mismatch");
  }
  if (!code || !realmId) {
    return redirectToConnector(origin, "missing_code");
  }

  const connector = await prisma.connector.findUnique({
    where: { type: "QUICKBOOKS_ONLINE" },
  });
  const stored: Record<string, unknown> = connector?.secretsEnc
    ? decryptJson<Record<string, unknown>>(connector.secretsEnc)
    : {};
  const config = (connector?.config as Record<string, unknown>) ?? {};
  const secrets = getEnvSecrets(stored, config) as QboSecrets;
  if (!secrets.clientId || !secrets.clientSecret) {
    return redirectToConnector(origin, "missing_client");
  }

  try {
    const redirectUri = `${origin}/api/connectors/quickbooks/callback`;
    const tokens = await exchangeCodeForTokens({
      code,
      redirectUri,
      clientId: secrets.clientId,
      clientSecret: secrets.clientSecret,
    });

    const next: QboSecrets = {
      ...secrets,
      realmId,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
      refreshTokenExpiresAt:
        Date.now() + tokens.x_refresh_token_expires_in * 1000,
    };

    const merged = setEnvSecrets(stored, config, next as Record<string, unknown>);
    await prisma.connector.upsert({
      where: { type: "QUICKBOOKS_ONLINE" },
      create: {
        type: "QUICKBOOKS_ONLINE",
        config: {},
        secretsEnc: encryptJson(merged),
      },
      update: { secretsEnc: encryptJson(merged) },
    });

    await audit({
      action: "CONNECTOR_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: "connector:QUICKBOOKS_ONLINE",
      metadata: { event: "qbo_oauth_connected", realmId },
    });

    return redirectToConnector(origin, "connected");
  } catch (err) {
    await audit({
      action: "CONNECTOR_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: "connector:QUICKBOOKS_ONLINE",
      metadata: { event: "qbo_oauth_failed", error: safeErrorMessage(err) },
    });
    return redirectToConnector(origin, "error");
  }
}
