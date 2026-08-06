import "server-only";
import { prisma } from "@/lib/db";
import { resolveSso } from "@/lib/auth/sso";
import { getGraphToken, graphGetChecked, graphPost } from "@/lib/crm/graph";
import { safeErrorMessage } from "@/lib/redact";
import { outboundAddress } from "@/lib/silverfang/email";

/**
 * Mail self-diagnostic.
 *
 * Written because "Graph is configured" and "Graph can read this mailbox" are
 * very different claims, and an app-only 403 from Exchange looks the same whether
 * the access policy excludes the mailbox, the wrong app registration is in use,
 * or the permission was consented as Delegated instead of Application.
 *
 * So this reports what the *token itself* says — which app and tenant it belongs
 * to, and which app roles it actually carries — then tests reading and sending
 * independently, because they need different permissions and fail differently.
 * No secrets are read or returned; the token is never included in the output.
 */

export interface MailDiagnostics {
  /** App (client) id the token was issued to, from its own claims. */
  tokenAppId: string | null;
  /** App id Wolf365 is configured with, for comparison. */
  configuredAppId: string | null;
  tenantId: string | null;
  /** Whether the two agree — a mismatch explains a "correctly configured" 403. */
  appIdMatches: boolean | null;
  /** Graph application roles the token carries (e.g. Mail.Read, Mail.Send). */
  roles: string[];
  hasMailRead: boolean;
  hasMailSend: boolean;
  mailbox: string | null;
  sendAs: string | null;
  /** Result of actually reading the mailbox. */
  read: { ok: boolean; status: number; detail?: string };
  /** Result of actually sending — only run when `trySend` is set. */
  send?: { ok: boolean; status: number; detail?: string };
  notes: string[];
}

/** Decode a JWT payload without verifying it — we issued the request for it. */
function decodeClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Run the diagnostic. `trySend` actually sends a message to `sendTo` — used only
 * when an admin explicitly asks, and deliberately not gated by the client-email
 * policy because it mails the operator, not a customer.
 */
export async function diagnoseMail(opts: {
  trySend?: boolean;
  sendTo?: string | null;
}): Promise<MailDiagnostics> {
  const notes: string[] = [];
  const sso = await resolveSso();
  const mailbox = await prisma.sfMailbox.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });

  const result: MailDiagnostics = {
    tokenAppId: null,
    configuredAppId: sso?.clientId ?? null,
    tenantId: sso?.tenantId ?? null,
    appIdMatches: null,
    roles: [],
    hasMailRead: false,
    hasMailSend: false,
    mailbox: mailbox?.address ?? null,
    sendAs: mailbox ? outboundAddress(mailbox) : null,
    read: { ok: false, status: 0, detail: "not attempted" },
    notes,
  };

  if (!sso) {
    notes.push("Entra SSO is not configured, so no app-only token can be obtained at all.");
    return result;
  }
  const token = await getGraphToken();
  if (!token) {
    notes.push(
      "Could not obtain an app-only token. The client secret may have expired — check Security & SSO.",
    );
    return result;
  }

  const claims = decodeClaims(token);
  const appid = claims?.appid ?? claims?.azp;
  result.tokenAppId = typeof appid === "string" ? appid : null;
  const tid = claims?.tid;
  if (typeof tid === "string") result.tenantId = tid;
  const roles = claims?.roles;
  result.roles = Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [];
  result.hasMailRead = result.roles.some((r) => /^Mail\.(Read|ReadWrite)$/.test(r));
  result.hasMailSend = result.roles.includes("Mail.Send");

  if (result.tokenAppId && result.configuredAppId) {
    result.appIdMatches = result.tokenAppId === result.configuredAppId;
  }

  // The roles claim is the ground truth: an Application permission that has been
  // admin-consented appears here. A Delegated one never does, however green it
  // looks in the portal.
  if (result.roles.length === 0) {
    notes.push(
      "The token carries no application roles at all. Either no Application permissions are " +
        "admin-consented on this app, or they were added as Delegated — Delegated permissions " +
        "do nothing for an app-only token and Exchange refuses the call as a policy block.",
    );
  } else {
    if (!result.hasMailRead) {
      notes.push(
        "Mail.Read / Mail.ReadWrite is missing from the token, so no mailbox can be polled. " +
          "Add it as an Application permission and grant admin consent.",
      );
    }
    if (!result.hasMailSend) {
      notes.push("Mail.Send is missing from the token, so no mail can be sent.");
    }
  }

  if (!mailbox) {
    notes.push("No mailbox is configured, so there is nothing to test against.");
    return result;
  }

  // Read test — the exact call the poller makes.
  const read = await graphGetChecked<{ value?: unknown[] }>(
    token,
    `/users/${encodeURIComponent(mailbox.address)}/mailFolders/inbox/messages?$select=id&$top=1`,
  );
  result.read = {
    ok: read.ok,
    status: read.status,
    ...(read.error ? { detail: read.error } : {}),
  };
  if (!read.ok && read.status === 403) {
    notes.push(
      `Reading ${mailbox.address} was refused with 403. If the token above carries Mail.ReadWrite ` +
        `and the app id matches, this is the Exchange application access policy — confirm the ` +
        `mailbox is in the policy's scope group.`,
    );
  }
  if (!read.ok && read.status === 404) {
    notes.push(
      `${mailbox.address} was not found. It may not be a real Exchange Online mailbox, or the ` +
        `address may be wrong.`,
    );
  }

  if (opts.trySend) {
    const to = (opts.sendTo ?? "").trim();
    if (!to) {
      result.send = { ok: false, status: 0, detail: "No recipient given for the send test." };
    } else {
      const from = outboundAddress(mailbox);
      const res = await graphPost(token, `/users/${encodeURIComponent(from)}/sendMail`, {
        message: {
          subject: "Wolf365 SilverFang mail test",
          body: {
            contentType: "Text",
            content:
              "This is a SilverFang diagnostic message. It confirms Wolf365 can send mail as " +
              `${from}. No ticket is involved and no client was emailed.`,
          },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      });
      result.send = {
        ok: res.ok,
        status: res.status,
        ...(res.error ? { detail: res.error } : {}),
      };
      if (!res.ok && res.status === 403) {
        notes.push(
          `Sending as ${from} was refused with 403. Reading and sending use different ` +
            `permissions and can be scoped separately, so this is worth comparing with the read ` +
            `result above.`,
        );
      }
    }
  }

  if (result.appIdMatches === false) {
    notes.push(
      `The token belongs to app ${result.tokenAppId} but Wolf365 is configured with ` +
        `${result.configuredAppId}. Consent and any Exchange access policy must be applied to ` +
        `the app the token actually comes from.`,
    );
  }

  return result;
}

/** One-line summary for an action result. */
export function describeDiagnostics(d: MailDiagnostics): string {
  const parts = [
    `app ${d.tokenAppId ?? "unknown"}`,
    d.appIdMatches === false ? "APP ID MISMATCH" : null,
    `roles: ${d.roles.length ? d.roles.join(", ") : "none"}`,
    `read ${d.read.ok ? "OK" : `HTTP ${d.read.status}`}`,
    d.send ? `send ${d.send.ok ? "OK" : `HTTP ${d.send.status}`}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Safe string for logging/showing an error detail. */
export function safeDetail(detail: unknown): string {
  return safeErrorMessage(detail, 300);
}
