import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import { getEnvSecrets } from "@/lib/connectors/secrets";
import { requirePermission } from "@/lib/auth/session";
import {
  QBO_AUTHORIZE_URL,
  QBO_SCOPE,
  type QboSecrets,
} from "@/connectors/quickbooks/oauth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "qbo_oauth_state";

/**
 * Begin the QuickBooks Online OAuth flow. Builds the Intuit authorization URL
 * using the stored client id and redirects the admin to consent. A random
 * state value is stored in an HTTP-only cookie for CSRF protection on callback.
 */
export async function GET(request: Request) {
  await requirePermission("connectors:configure");

  const connector = await prisma.connector.findUnique({
    where: { type: "QUICKBOOKS_ONLINE" },
  });
  const stored: Record<string, unknown> = connector?.secretsEnc
    ? decryptJson<Record<string, unknown>>(connector.secretsEnc)
    : {};
  const config = (connector?.config as Record<string, unknown>) ?? {};
  const secrets = getEnvSecrets(stored, config) as QboSecrets;
  if (!secrets.clientId) {
    return NextResponse.json(
      { error: "Save the QuickBooks OAuth Client ID/Secret before connecting." },
      { status: 400 },
    );
  }

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/connectors/quickbooks/callback`;
  const state = randomBytes(24).toString("base64url");

  const authorizeUrl = new URL(QBO_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", secrets.clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", QBO_SCOPE);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authorizeUrl.toString());
}
