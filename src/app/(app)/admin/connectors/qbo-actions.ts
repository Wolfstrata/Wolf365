"use server";

import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ConnectorHealth } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { getEnvSecrets, setEnvSecrets } from "@/lib/connectors/secrets";
import { requirePermission } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";
import {
  QBO_AUTHORIZE_URL,
  QBO_SCOPE,
  revokeToken,
  type QboSecrets,
} from "@/connectors/quickbooks/oauth";

const STATE_COOKIE = "qbo_oauth_state";
const CONNECTOR_PAGE = "/admin/connectors/QUICKBOOKS_ONLINE";

/** Origin of the current request (for the OAuth redirect URI). */
async function currentOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${h.get("host")}`;
}

/**
 * Begin the QuickBooks OAuth flow. A POST server action (CSRF-protected by
 * Next.js) rather than a GET route, so it can't be triggered cross-site. Sets
 * the CSRF state cookie and redirects to Intuit's consent screen.
 */
export async function connectQuickBooksAction(): Promise<void> {
  const user = await requirePermission("connectors:configure");
  const rl = await rateLimit(`qbo-connect:${user.id}`, 30, 60_000);
  if (!rl.ok) redirect(`${CONNECTOR_PAGE}?qbo=rate_limited`);

  const connector = await prisma.connector.findUnique({
    where: { type: "QUICKBOOKS_ONLINE" },
  });
  const stored: Record<string, unknown> = connector?.secretsEnc
    ? decryptJson<Record<string, unknown>>(connector.secretsEnc)
    : {};
  const config = (connector?.config as Record<string, unknown>) ?? {};
  const secrets = getEnvSecrets(stored, config) as QboSecrets;
  if (!secrets.clientId) redirect(`${CONNECTOR_PAGE}?qbo=missing_client`);

  const redirectUri = `${await currentOrigin()}/api/connectors/quickbooks/callback`;
  const state = randomBytes(24).toString("base64url");

  const authorizeUrl = new URL(QBO_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", secrets.clientId!);
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

  redirect(authorizeUrl.toString());
}

/**
 * Disconnect QuickBooks: revoke the token with Intuit and clear the stored
 * connection for the active environment (keeping client id/secret for reconnect).
 * A POST server action so it can't be triggered via a cross-site GET.
 */
export async function disconnectQuickBooksAction(): Promise<void> {
  const user = await requirePermission("connectors:configure");
  const rl = await rateLimit(`qbo-disconnect:${user.id}`, 30, 60_000);
  if (!rl.ok) redirect(`${CONNECTOR_PAGE}?qbo=rate_limited`);

  const connector = await prisma.connector.findUnique({
    where: { type: "QUICKBOOKS_ONLINE" },
  });
  if (!connector?.secretsEnc) redirect(`${CONNECTOR_PAGE}?qbo=not_connected`);

  const stored = decryptJson<Record<string, unknown>>(connector!.secretsEnc!);
  const config = (connector!.config as Record<string, unknown>) ?? {};
  const secrets = getEnvSecrets(stored, config) as QboSecrets;

  try {
    if (secrets.clientId && secrets.clientSecret && secrets.refreshToken) {
      await revokeToken({
        clientId: secrets.clientId,
        clientSecret: secrets.clientSecret,
        token: secrets.refreshToken,
      });
    }
    const cleared: QboSecrets = {
      clientId: secrets.clientId,
      clientSecret: secrets.clientSecret,
    };
    const merged = setEnvSecrets(stored, config, cleared as Record<string, unknown>);
    await prisma.connector.update({
      where: { type: "QUICKBOOKS_ONLINE" },
      data: { secretsEnc: encryptJson(merged), health: ConnectorHealth.UNCONFIGURED },
    });
    await audit({
      action: "CONNECTOR_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: "connector:QUICKBOOKS_ONLINE",
      metadata: { event: "qbo_disconnected" },
    });
  } catch (err) {
    await audit({
      action: "CONNECTOR_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: "connector:QUICKBOOKS_ONLINE",
      metadata: { event: "qbo_disconnect_failed", error: safeErrorMessage(err) },
    });
    redirect(`${CONNECTOR_PAGE}?qbo=disconnect_error`);
  }
  revalidatePath(CONNECTOR_PAGE);
  redirect(`${CONNECTOR_PAGE}?qbo=disconnected`);
}
