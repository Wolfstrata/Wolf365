import "server-only";
import type { SfMailbox } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getGraphToken, graphGetChecked, graphPost, graphPatch } from "@/lib/crm/graph";
import { sendEmail } from "@/lib/email/resend";
import { safeErrorMessage } from "@/lib/redact";
import {
  TICKET_HEADER,
  normalizeAddress,
  outboundAddress,
  parseAddressList,
  pollFloor,
} from "@/lib/silverfang/email";
import { decideOutbound, type BlockReason } from "@/lib/silverfang/email-policy";

/**
 * SilverFang mail transport: the I/O edge for sending ticket email and reading a
 * support mailbox. All the decisions (threading, subject tags, quote stripping)
 * live in the pure email.ts; this file only moves bytes.
 *
 * Two providers:
 *  - GRAPH — a Microsoft 365 shared mailbox, using the app-only token already
 *    used elsewhere. Needs Mail.Send and Mail.ReadWrite *application*
 *    permissions consented on the Entra app. This is the only provider that can
 *    also *receive*.
 *  - RESEND — outbound only, via the existing transactional sender. Useful
 *    before Graph mail permissions are granted, and it can set real
 *    In-Reply-To/References headers (Graph cannot — see below).
 *
 * Graph limitation worth knowing: `sendMail` only accepts custom
 * `internetMessageHeaders` beginning with `x-`, so In-Reply-To/References cannot
 * be set on that path. That is why the ticket tag in the subject — plus the
 * `x-silverfang-ticket` header — is the primary threading mechanism, and RFC
 * headers are only a fallback for routing inbound mail.
 */

export type MailProvider = "GRAPH" | "RESEND";

/** Fixed primary key of the single SfEmailPolicy row. */
export const POLICY_ID = "singleton";

/**
 * Who this mail is going to. Required, and deliberately not defaulted: a new send
 * path has to state whether it is mailing a customer, and mailing a customer is
 * gated on that client's explicit opt-in. Making it a required field is what
 * stops the gate being forgotten.
 */
export type MailAudience =
  | { kind: "CLIENT"; clientId: string }
  | { kind: "INTERNAL" };

export interface OutboundMail {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html: string;
  /** Ticket number, stamped as a custom header so replies route reliably. */
  ticketNumber: number;
  /** RFC threading, honoured on the Resend path only (see note above). */
  inReplyTo?: string | null;
  references?: string | null;
  audience: MailAudience;
}

export interface SendResult {
  sent: boolean;
  provider: MailProvider | null;
  /** Provider-side id, when one is returned. */
  providerId?: string;
  reason?: string;
  /**
   * True when a policy gate refused the send. Distinct from a failure: nothing
   * went wrong, the send simply was not permitted.
   */
  blockedByPolicy?: boolean;
  /** Which gate refused it, when one did. */
  blockReason?: BlockReason;
}

/** Graph's shape for a mail message we read from a mailbox. */
interface GraphMessage {
  id?: string;
  internetMessageId?: string;
  subject?: string | null;
  receivedDateTime?: string;
  bodyPreview?: string | null;
  body?: { contentType?: string; content?: string } | null;
  from?: { emailAddress?: { address?: string; name?: string } } | null;
  sender?: { emailAddress?: { address?: string; name?: string } } | null;
  toRecipients?: { emailAddress?: { address?: string } }[] | null;
  ccRecipients?: { emailAddress?: { address?: string } }[] | null;
  internetMessageHeaders?: { name?: string; value?: string }[] | null;
  conversationId?: string | null;
}

const MESSAGE_FIELDS = [
  "id",
  "internetMessageId",
  "subject",
  "receivedDateTime",
  "body",
  "bodyPreview",
  "from",
  "sender",
  "toRecipients",
  "ccRecipients",
  "conversationId",
].join(",");

/**
 * The master email policy. A missing row is "disabled" — email must never start
 * flowing just because this table has never been written to.
 */
export async function loadEmailPolicy(): Promise<{ outboundEnabled: boolean } | null> {
  return prisma.sfEmailPolicy.findUnique({
    where: { id: POLICY_ID },
    select: { outboundEnabled: true },
  });
}

/** The mailbox to send a ticket reply from: the ticket's own, else any outbound one. */
export async function resolveOutboundMailbox(
  preferredId?: string | null,
): Promise<SfMailbox | null> {
  if (preferredId) {
    const preferred = await prisma.sfMailbox.findUnique({ where: { id: preferredId } });
    if (preferred && preferred.active && preferred.outbound) return preferred;
  }
  return prisma.sfMailbox.findFirst({
    where: { active: true, outbound: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Send one ticket email. Never throws — a failed send is reported so the caller
 * can surface it and *not* record a message that never left the building.
 */
export async function sendTicketMail(
  mailbox: SfMailbox,
  mail: OutboundMail,
): Promise<SendResult> {
  const to = parseAddressList(mail.to);
  if (to.length === 0) return { sent: false, provider: null, reason: "No valid recipients" };
  const cc = parseAddressList(mail.cc ?? []);

  // HARD RULE, enforced here rather than at the callers, because this is the
  // single choke point every send goes through: the master switch must be on, and
  // for client mail that client must be opted in as well. Neither gate can be
  // bypassed by adding a new send path.
  const policy = await loadEmailPolicy();
  let client: { name: string; sfClientProfile: { allowClientEmail: boolean } | null } | null =
    null;
  if (mail.audience.kind === "CLIENT") {
    client = await prisma.client.findUnique({
      where: { id: mail.audience.clientId },
      select: { name: true, sfClientProfile: { select: { allowClientEmail: true } } },
    });
    if (!client) {
      return { sent: false, provider: null, reason: "That client no longer exists." };
    }
  }
  const decision = decideOutbound({
    policy,
    audience: mail.audience.kind,
    clientProfile: client?.sfClientProfile,
    clientName: client?.name,
  });
  if (!decision.allowed) {
    return {
      sent: false,
      provider: null,
      blockedByPolicy: true,
      blockReason: decision.reason,
      reason: decision.message,
    };
  }

  const provider: MailProvider = mailbox.provider === "RESEND" ? "RESEND" : "GRAPH";
  // May differ from the polled address when a front-door address forwards in.
  const fromAddress = outboundAddress(mailbox);

  try {
    if (provider === "RESEND") {
      const result = await sendEmail({
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        to,
        cc,
        from: mailbox.name ? `${mailbox.name} <${fromAddress}>` : fromAddress,
        replyTo: fromAddress,
        headers: {
          [TICKET_HEADER]: String(mail.ticketNumber),
          ...(mail.inReplyTo ? { "In-Reply-To": mail.inReplyTo } : {}),
          ...(mail.references ? { References: mail.references } : {}),
        },
      });
      return {
        sent: result.sent,
        provider,
        ...(result.providerId ? { providerId: result.providerId } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
      };
    }

    const token = await getGraphToken();
    if (!token) {
      return {
        sent: false,
        provider,
        reason:
          "Microsoft Graph is not configured (Entra SSO credentials missing), so mail cannot be sent.",
      };
    }
    const res = await graphPost(
      token,
      `/users/${encodeURIComponent(fromAddress)}/sendMail`,
      {
        message: {
          subject: mail.subject,
          body: { contentType: "HTML", content: mail.html },
          toRecipients: to.map((address) => ({ emailAddress: { address } })),
          ccRecipients: cc.map((address) => ({ emailAddress: { address } })),
          // Graph permits custom x-* headers only; the ticket number is what we
          // actually need on the way back in.
          internetMessageHeaders: [
            { name: TICKET_HEADER, value: String(mail.ticketNumber) },
          ],
        },
        saveToSentItems: true,
      },
    );
    if (!res.ok) {
      return {
        sent: false,
        provider,
        // Name the address so a policy that covers the polled mailbox but not the
        // reply-as address is obvious rather than mystifying.
        reason: `Graph sendMail as ${fromAddress} failed (HTTP ${res.status}): ${
          res.error ?? "unknown error"
        }`,
      };
    }
    // sendMail returns 202 with no body, so there is no provider id to record.
    return { sent: true, provider };
  } catch (err) {
    return { sent: false, provider, reason: safeErrorMessage(err) };
  }
}

export interface FetchedMessage {
  externalId: string | null;
  messageId: string | null;
  subject: string | null;
  from: string | null;
  fromName: string | null;
  to: string[];
  cc: string[];
  text: string;
  html: string | null;
  receivedAt: Date | null;
  headers: Record<string, string>;
  ticketNumberHint: number | null;
  raw: unknown;
}

function headerMap(msg: GraphMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of msg.internetMessageHeaders ?? []) {
    if (h?.name && typeof h.value === "string") out[h.name.toLowerCase()] = h.value;
  }
  return out;
}

function mapGraphMessage(msg: GraphMessage): FetchedMessage {
  const headers = headerMap(msg);
  const hint = Number.parseInt(headers[TICKET_HEADER] ?? "", 10);
  const isHtml = (msg.body?.contentType ?? "").toLowerCase() === "html";
  const content = msg.body?.content ?? "";
  const fromAddr =
    msg.from?.emailAddress?.address ?? msg.sender?.emailAddress?.address ?? null;
  return {
    externalId: msg.id ?? null,
    messageId: msg.internetMessageId ?? null,
    subject: msg.subject ?? null,
    from: normalizeAddress(fromAddr),
    fromName: msg.from?.emailAddress?.name ?? msg.sender?.emailAddress?.name ?? null,
    to: parseAddressList((msg.toRecipients ?? []).map((r) => r.emailAddress?.address ?? "")),
    cc: parseAddressList((msg.ccRecipients ?? []).map((r) => r.emailAddress?.address ?? "")),
    text: isHtml ? "" : content,
    html: isHtml ? content : null,
    receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : null,
    headers: {
      ...headers,
      ...(msg.conversationId ? { "x-graph-conversation-id": msg.conversationId } : {}),
    },
    ticketNumberHint: Number.isSafeInteger(hint) && hint > 0 ? hint : null,
    raw: msg,
  };
}

export interface FetchResult {
  ok: boolean;
  messages: FetchedMessage[];
  error?: string;
}

/**
 * Read new mail from a mailbox's inbox, oldest first, above the stored
 * watermark. Oldest-first matters: the watermark only advances past messages we
 * have actually processed, so an interrupted run re-reads rather than skips.
 */
export async function fetchMailboxMessages(
  mailbox: SfMailbox,
  limit = 25,
): Promise<FetchResult> {
  if (mailbox.provider !== "GRAPH") {
    return {
      ok: false,
      messages: [],
      error: `Mailbox ${mailbox.address} uses the ${mailbox.provider} provider, which cannot receive mail.`,
    };
  }
  const token = await getGraphToken();
  if (!token) {
    return {
      ok: false,
      messages: [],
      error: "Microsoft Graph is not configured (Entra SSO credentials missing).",
    };
  }

  const params = new URLSearchParams({
    $select: MESSAGE_FIELDS,
    $orderby: "receivedDateTime asc",
    $top: String(Math.min(Math.max(limit, 1), 50)),
  });
  // Never reach further back than the later of the watermark and the cutoff, so
  // an established mailbox is not worked through from its oldest message.
  const floor = pollFloor(mailbox.lastMessageAt, mailbox.ignoreBefore);
  if (floor) {
    params.set("$filter", `receivedDateTime gt ${floor.toISOString()}`);
  }
  const res = await graphGetChecked<{ value?: GraphMessage[] }>(
    token,
    `/users/${encodeURIComponent(mailbox.address)}/mailFolders/inbox/messages?${params.toString()}`,
  );
  if (!res.ok) {
    return {
      ok: false,
      messages: [],
      error: `Graph mailbox read failed (HTTP ${res.status}): ${res.error ?? "unknown error"}`,
    };
  }
  return { ok: true, messages: (res.data?.value ?? []).map(mapGraphMessage) };
}

/**
 * Mark a processed message read so a human looking at the shared mailbox can see
 * what SilverFang has already taken. Best-effort: the watermark, not the read
 * flag, is what prevents reprocessing.
 */
export async function markMessageRead(mailbox: SfMailbox, externalId: string): Promise<void> {
  if (mailbox.provider !== "GRAPH") return;
  const token = await getGraphToken();
  if (!token) return;
  await graphPatch(
    token,
    `/users/${encodeURIComponent(mailbox.address)}/messages/${encodeURIComponent(externalId)}`,
    { isRead: true },
  );
}
