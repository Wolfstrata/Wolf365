"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ConnectorHealth } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptJson } from "@/lib/crypto";
import { setEnvSecrets } from "@/lib/connectors/secrets";
import { requirePermission } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";
import {
  QBO_SCOPE,
  revokeToken,
  type QboEnvironment,
  type QboSecrets,
} from "@/connectors/quickbooks/oauth";
import { getQboEndpoints } from "@/connectors/quickbooks/discovery";
import { loadQboConnection, qboRedirectUri } from "@/connectors/quickbooks/store";
import { purgeNonProductionQboData } from "@/lib/maintenance/qbo-cleanup";

const STATE_COOKIE = "qbo_oauth_state";
const CONNECTOR_PAGE = "/admin/connectors/QUICKBOOKS_ONLINE";

export interface QboCleanupActionResult {
  ok: boolean;
  message: string;
}

/**
 * Remove leftover sandbox/test QuickBooks data, keeping only the connected
 * production company's records. DESTRUCTIVE but scoped by production realm id.
 */
export async function cleanupSandboxDataAction(
  _prev: QboCleanupActionResult | null,
  _formData: FormData,
): Promise<QboCleanupActionResult> {
  const user = await requirePermission("connectors:configure");
  const rl = await rateLimit(`qbo-cleanup:${user.id}`, 10, 60_000);
  if (!rl.ok) return { ok: false, message: "Too many attempts — wait a moment and retry." };
  try {
    const result = await purgeNonProductionQboData();
    if (result.ok) {
      await audit({
        action: "SANDBOX_DATA_PURGED",
        actorId: user.id,
        actorEmail: user.email,
        target: "connector:QUICKBOOKS_ONLINE",
        metadata: {
          customersDeleted: result.customersDeleted,
          itemsDeleted: result.itemsDeleted,
          clientsDeleted: result.clientsDeleted,
          clientsKept: result.clientsKept,
        },
      });
      revalidatePath(CONNECTOR_PAGE);
      revalidatePath("/clients");
    }
    return { ok: result.ok, message: result.message };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
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

  const { config, secrets } = await loadQboConnection();
  if (!secrets.clientId) redirect(`${CONNECTOR_PAGE}?qbo=missing_client`);

  const env = (config.environment as QboEnvironment) ?? "sandbox";
  const { authorizationEndpoint } = await getQboEndpoints(env);
  const redirectUri = await qboRedirectUri();
  const state = randomBytes(24).toString("base64url");

  const authorizeUrl = new URL(authorizationEndpoint);
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
 * Disconnect QuickBooks: revoke the token with Intuit (best-effort) and ALWAYS
 * clear the stored connection for the active environment (keeping client id/
 * secret for reconnect). The local clear must succeed even if Intuit's revoke
 * endpoint is unreachable. A POST server action (CSRF-protected by Next.js).
 */
export async function disconnectQuickBooksAction(): Promise<void> {
  const user = await requirePermission("connectors:configure");
  const rl = await rateLimit(`qbo-disconnect:${user.id}`, 30, 60_000);
  if (!rl.ok) redirect(`${CONNECTOR_PAGE}?qbo=rate_limited`);

  const { connector, stored, config, secrets } = await loadQboConnection();
  if (!connector?.secretsEnc) redirect(`${CONNECTOR_PAGE}?qbo=not_connected`);

  // Best-effort revoke with Intuit — must NOT block the local disconnect.
  let revokeError: string | null = null;
  if (secrets.clientId && secrets.clientSecret && secrets.refreshToken) {
    try {
      const env = (config.environment as QboEnvironment) ?? "sandbox";
      const { revocationEndpoint } = await getQboEndpoints(env);
      await revokeToken({
        clientId: secrets.clientId,
        clientSecret: secrets.clientSecret,
        token: secrets.refreshToken,
        revokeUrl: revocationEndpoint,
      });
    } catch (err) {
      revokeError = safeErrorMessage(err);
    }
  }

  // Always clear the stored connection (keep client id/secret for reconnect).
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
    metadata: { event: "qbo_disconnected", revokeError },
  });

  revalidatePath(CONNECTOR_PAGE);
  // If the remote revoke failed, the local connection is still cleared; surface
  // a partial-success status so the admin knows to revoke in Intuit manually.
  redirect(`${CONNECTOR_PAGE}?qbo=${revokeError ? "disconnected_local" : "disconnected"}`);
}
