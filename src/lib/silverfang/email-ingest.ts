import "server-only";
import type { Prisma, SfMailbox } from "@prisma/client";
import { prisma } from "@/lib/db";
import { contactEmailIndex, contactWrite, textWrite } from "@/lib/silverfang/pii";
import { nameFromAddress, splitName } from "@/lib/silverfang/contacts";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";
import {
  addressDomain,
  htmlToPlainText,
  isAutoSubmitted,
  isPublicEmailDomain,
  normalizeAddress,
  ownAddresses,
  parseAddressList,
  parseTicketNumber,
  referencedMessageIds,
  sameAddress,
  stripQuotedReply,
  summaryFromSubject,
} from "@/lib/silverfang/email";
import { runAutoResponses } from "@/lib/silverfang/auto-response";
import { decisionOf } from "@/lib/silverfang/ingest-outcomes";
import { boardNameFor } from "@/lib/silverfang/boards";
import {
  fetchMailboxMessages,
  markMessageRead,
  type FetchedMessage,
} from "@/lib/silverfang/mail";
import { loadSla, nextTicketNumber, slaDueDatesFor } from "@/lib/silverfang/service";
import { pausedMinutesFor } from "@/lib/silverfang/sla";

/**
 * Inbound ticket email: decide which ticket a message belongs to, then file it.
 *
 * Routing order (first hit wins):
 *  1. the `x-silverfang-ticket` header we stamp on our own outbound mail
 *  2. the `[SF-1042]` tag in the subject
 *  3. In-Reply-To / References matched against message-ids we have stored
 *  4. no match → open a new ticket
 *
 * Nothing is ever silently dropped: every path returns either a ticket or a
 * named reason, and the callers (webhook + cron) report those counts.
 */

export interface InboundEmail {
  /** Which support mailbox received it. Optional when only one is configured. */
  mailboxAddress?: string | null;
  from: string | null;
  fromName?: string | null;
  to?: string[] | string | null;
  cc?: string[] | string | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  /** Provider-side id (Graph message id), for dedupe and read-marking. */
  externalId?: string | null;
  receivedAt?: Date | null;
  headers?: Record<string, string> | null;
  /** Ticket number taken from our own header, when present. */
  ticketNumberHint?: number | null;
  raw?: unknown;
}

export type IngestSkipReason =
  | "missing-sender"
  | "loop-self"
  | "auto-reply"
  | "unknown-sender"
  | "no-board"
  | "no-mailbox"
  | "error";

export type IngestResult =
  | { ok: true; action: "created" | "appended"; ticketId: string; ticketNumber: number }
  | { ok: true; action: "deduped"; ticketId: string | null }
  | { ok: false; reason: IngestSkipReason; detail?: string };

/** The mailbox that received a message: named address, else the only inbound one. */
async function resolveInboundMailbox(address: string | null): Promise<SfMailbox | null> {
  const normalized = normalizeAddress(address);
  if (normalized) {
    // Match the reply-as address too: a webhook forwarding mail that was sent to
    // the front-door address (support@) still belongs to the mailbox we poll
    // (help@), and the flow has no way to know the difference.
    const named = await prisma.sfMailbox.findFirst({
      where: { OR: [{ address: normalized }, { sendAsAddress: normalized }] },
      orderBy: { createdAt: "asc" },
    });
    if (named?.active && named.inbound) return named;
    if (named) return null; // named but disabled — do not silently use another
  }
  const candidates = await prisma.sfMailbox.findMany({
    where: { active: true, inbound: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  // Only fall back when there is exactly one, so mail can never be filed against
  // an arbitrary mailbox on a multi-mailbox install.
  return candidates.length === 1 ? candidates[0]! : null;
}

/** Whether this exact message has already been filed. */
async function findDuplicate(
  input: InboundEmail,
  mailboxId: string | null,
): Promise<{ ticketId: string } | null> {
  if (input.messageId) {
    const byMessageId = await prisma.sfTicketMessage.findUnique({
      where: { messageId: input.messageId },
      select: { ticketId: true },
    });
    if (byMessageId) return byMessageId;
  }
  if (input.externalId) {
    const byExternal = await prisma.sfTicketMessage.findFirst({
      where: { externalId: input.externalId, mailboxId },
      select: { ticketId: true },
    });
    if (byExternal) return byExternal;
  }
  return null;
}

/** Locate the ticket a message belongs to, by tag/header then by threading headers. */
async function findTicket(input: InboundEmail): Promise<{ id: string; number: number } | null> {
  const number = input.ticketNumberHint ?? parseTicketNumber(input.subject);
  if (number != null) {
    const byNumber = await prisma.sfTicket.findUnique({
      where: { number },
      select: { id: true, number: true },
    });
    if (byNumber) return byNumber;
  }
  const referenced = referencedMessageIds(input);
  if (referenced.length > 0) {
    const prior = await prisma.sfTicketMessage.findFirst({
      where: { messageId: { in: referenced } },
      orderBy: { createdAt: "desc" },
      select: { ticket: { select: { id: true, number: true } } },
    });
    if (prior?.ticket) return prior.ticket;
  }
  return null;
}

interface SenderMatch {
  clientId: string;
  contactId: string | null;
  via: "contact" | "domain" | "fallback";
}

/**
 * Work out which client an unknown message belongs to: the sender's contact
 * record, else another contact on the same business domain, else the mailbox's
 * configured fallback client. Consumer domains are never domain-matched.
 */
async function resolveSender(from: string, mailbox: SfMailbox): Promise<SenderMatch | null> {
  // The address column is encrypted, so it is matched via its blind index.
  const contact = await prisma.sfContact.findFirst({
    where: {
      emailIndex: contactEmailIndex(from),
      active: true,
      client: { archived: false },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true, clientId: true },
  });
  if (contact) return { clientId: contact.clientId, contactId: contact.id, via: "contact" };

  const domain = addressDomain(from);
  if (domain && !isPublicEmailDomain(domain)) {
    const peers = await prisma.sfContact.findMany({
      where: {
        // Matched on the domain column, kept in the clear precisely so this
        // fallback still works with the address itself encrypted.
        emailDomain: domain,
        active: true,
        client: { archived: false },
      },
      select: { clientId: true },
      take: 200,
    });
    if (peers.length > 0) {
      // Most contacts on that domain wins; ties resolve to the first seen.
      const counts = new Map<string, number>();
      for (const p of peers) counts.set(p.clientId, (counts.get(p.clientId) ?? 0) + 1);
      let bestId = peers[0]!.clientId;
      let best = 0;
      for (const [clientId, count] of counts) {
        if (count > best) {
          best = count;
          bestId = clientId;
        }
      }
      return { clientId: bestId, contactId: null, via: "domain" };
    }
  }

  if (mailbox.fallbackClientId) {
    const fallback = await prisma.client.findFirst({
      where: { id: mailbox.fallbackClientId, archived: false },
      select: { id: true },
    });
    if (fallback) return { clientId: fallback.id, contactId: null, via: "fallback" };
  }
  return null;
}

/**
 * Create a contact for a sender we matched by domain.
 *
 * The company is known — other contacts share this domain — but the person is not.
 * Recording them turns a one-off match into a real requester: the next message
 * matches by address instead of by domain, a reply has somewhere to go, and the
 * ticket shows who raised it.
 *
 * Provenance is stamped as EMAIL/<address>, which the (sourceSystem, externalId)
 * unique constraint turns into idempotency — two messages racing in from the same
 * new sender cannot produce two contacts.
 *
 * Never throws. A contact we failed to create must not cost us the ticket; the
 * ticket is simply filed without a requester, exactly as before.
 */
async function autoCreateContact(
  from: string,
  fromName: string | null,
  clientId: string,
): Promise<string | null> {
  try {
    // The display name the sender's own mail client set is better than anything
    // derived from the address, so it wins when present.
    const parsed = splitName(fromName) ?? nameFromAddress(from);
    if (!parsed) return null;

    const created = await prisma.sfContact.create({
      data: {
        clientId,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        // Encrypted, with the blind index and domain derived in the same write —
        // the index is what makes the NEXT message from them match by address.
        ...contactWrite({ email: from }),
        sourceSystem: AUTO_CONTACT_SOURCE,
        externalId: from,
        // Deliberately not primary: an unknown sender is not the main contact for a
        // company just because they emailed first.
        isPrimary: false,
        active: true,
      },
      select: { id: true },
    });
    return created.id;
  } catch {
    // Most likely a unique-constraint collision from a concurrent ingest of the
    // same sender. Look up whoever won the race so the ticket still gets them.
    const existing = await prisma.sfContact
      .findFirst({ where: { emailIndex: contactEmailIndex(from) }, select: { id: true } })
      .catch(() => null);
    return existing?.id ?? null;
  }
}

/** Provenance for contacts the mail path created, distinct from an import. */
export const AUTO_CONTACT_SOURCE = "EMAIL";

/**
 * The board a new ticket from this mailbox opens on, with its statuses.
 *
 * Order of preference: the mailbox's configured board, then the client's default,
 * then the board the *kind of work* routes to, then any usable board. The explicit
 * settings win because somebody chose them; routing is the sensible default rather
 * than an override.
 */
async function resolveBoard(mailbox: SfMailbox, clientId: string) {
  const include = { statuses: { orderBy: { sortOrder: "asc" as const } } };
  if (mailbox.boardId) {
    const board = await prisma.sfBoard.findFirst({
      where: { id: mailbox.boardId, active: true },
      include,
    });
    if (board && board.statuses.length > 0) return board;
  }
  const profile = await prisma.sfClientProfile.findUnique({
    where: { clientId },
    select: { defaultBoardId: true, defaultAgreementId: true },
  });
  if (profile?.defaultBoardId) {
    const board = await prisma.sfBoard.findFirst({
      where: { id: profile.defaultBoardId, active: true },
      include,
    });
    if (board && board.statuses.length > 0) return board;
  }

  // Inbound mail never carries a project, so this routes to MSA when the client's
  // default agreement is a managed one, and to the catch-all otherwise.
  const agreement = profile?.defaultAgreementId
    ? await prisma.sfAgreement.findUnique({
        where: { id: profile.defaultAgreementId },
        select: { type: true },
      })
    : null;
  const routed = await prisma.sfBoard.findFirst({
    where: {
      name: boardNameFor({ hasProject: false, agreementType: agreement?.type ?? null }),
      active: true,
    },
    include,
  });
  if (routed && routed.statuses.length > 0) return routed;

  const boards = await prisma.sfBoard.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    include,
  });
  return boards.find((b) => b.statuses.length > 0) ?? null;
}

/** Readable body text from whatever the provider gave us, quotes removed. */
function bodyTextOf(input: InboundEmail): string {
  const raw = input.text?.trim() ? input.text : htmlToPlainText(input.html);
  return stripQuotedReply(raw);
}

/**
 * File one inbound email. Idempotent per message-id, so a re-delivered webhook
 * or a re-read mailbox does not duplicate anything.
 */
export async function ingestInboundEmail(input: InboundEmail): Promise<IngestResult> {
  try {
    const from = normalizeAddress(input.from);
    if (!from) return { ok: false, reason: "missing-sender" };

    const mailbox = await resolveInboundMailbox(input.mailboxAddress ?? null);
    if (!mailbox) {
      return {
        ok: false,
        reason: "no-mailbox",
        detail: input.mailboxAddress
          ? `No active inbound mailbox matches ${input.mailboxAddress}.`
          : "No inbound mailbox is configured (or more than one exists and the message named none).",
      };
    }

    // Our own outbound mail bouncing back in would loop forever. Covers the
    // reply-as address too, which is what a forwarding front door delivers as.
    if (ownAddresses(mailbox).some((own) => sameAddress(from, own))) {
      return { ok: false, reason: "loop-self" };
    }

    const duplicate = await findDuplicate(input, mailbox.id);
    if (duplicate) return { ok: true, action: "deduped", ticketId: duplicate.ticketId };

    const auto = isAutoSubmitted({ headers: input.headers, subject: input.subject });
    const existing = await findTicket(input);
    const text = bodyTextOf(input);
    const toAddresses = parseAddressList(input.to ?? []);
    const ccAddresses = parseAddressList(input.cc ?? []);
    const receivedAt = input.receivedAt ?? new Date();
    const rawJson =
      input.raw === undefined ? undefined : (input.raw as Prisma.InputJsonValue);

    if (existing) {
      await appendToTicket(existing.id, {
        mailbox,
        from,
        toAddresses,
        ccAddresses,
        input,
        text,
        receivedAt,
        rawJson,
      });
      await audit({
        action: "TICKET_EMAIL_RECEIVED",
        actorId: null,
        actorEmail: from,
        target: `sfTicket:${existing.id}`,
        metadata: { number: existing.number, mailbox: mailbox.address, appended: true, auto },
      });
      // A reply on an existing ticket may fire a rule, but never in answer to an
      // out-of-office.
      await runAutoResponses("NOTE_ADDED", existing.id, { suppress: auto });
      return { ok: true, action: "appended", ticketId: existing.id, ticketNumber: existing.number };
    }

    // Auto-replies must not open tickets — that is how an OOO loop starts.
    if (auto) return { ok: false, reason: "auto-reply" };

    const sender = await resolveSender(from, mailbox);
    if (!sender) {
      return {
        ok: false,
        reason: "unknown-sender",
        detail: `No contact, client domain or fallback client matches ${from}.`,
      };
    }
    // A domain match means we know the company but not the person. Create the
    // contact so the ticket has a real requester, the next mail from them matches
    // by address rather than by domain, and a reply has somewhere to go.
    //
    // Only for a domain match. A `fallback` match is the mailbox's catch-all client
    // — a guess, not evidence this person belongs there — so inventing a contact
    // on it would attach strangers to whichever client happened to be configured.
    let contactId = sender.contactId;
    if (!contactId && sender.via === "domain") {
      contactId = await autoCreateContact(from, input.fromName ?? null, sender.clientId);
    }

    const board = await resolveBoard(mailbox, sender.clientId);
    if (!board) {
      return {
        ok: false,
        reason: "no-board",
        detail: "No active board with statuses exists — run SilverFang Setup first.",
      };
    }
    const status = board.statuses.find((s) => s.isDefault) ?? board.statuses[0]!;
    const openedAt = receivedAt;
    const sla = await slaDueDatesFor(board.slaId, mailbox.defaultPriority, openedAt);

    const created = await prisma.$transaction(async (tx) => {
      const number = await nextTicketNumber(tx);
      const ticket = await tx.sfTicket.create({
        data: {
          number,
          clientId: sender.clientId,
          contactId,
          boardId: board.id,
          statusId: status.id,
          priority: mailbox.defaultPriority,
          source: "EMAIL",
          summary: summaryFromSubject(input.subject),
          description: textWrite(text || null),
          slaId: board.slaId,
          responseDueAt: sla.responseDueAt,
          resolutionDueAt: sla.resolutionDueAt,
          openedAt,
          createdByEmail: from,
          slaEvents: { create: { kind: "STARTED", note: `Opened from email (${from})` } },
        },
      });
      await tx.sfTicketMessage.create({
        data: {
          ticketId: ticket.id,
          mailboxId: mailbox.id,
          direction: "INBOUND",
          fromAddress: textWrite(from) ?? from,
          toAddresses,
          ccAddresses,
          subject: input.subject ?? null,
          bodyText: textWrite(text || null),
          bodyHtml: textWrite(input.html ?? null),
          messageId: input.messageId ?? null,
          inReplyTo: input.inReplyTo ?? null,
          references: input.references ?? null,
          externalId: input.externalId ?? null,
          receivedAt,
          ...(rawJson !== undefined ? { raw: rawJson } : {}),
        },
      });
      return ticket;
    });

    await audit({
      action: "TICKET_EMAIL_RECEIVED",
      actorId: null,
      actorEmail: from,
      target: `sfTicket:${created.id}`,
      metadata: {
        number: created.number,
        mailbox: mailbox.address,
        clientMatchedVia: sender.via,
        contactAutoCreated: contactId != null && sender.contactId == null,
        created: true,
      },
    });
    await runAutoResponses("TICKET_CREATED", created.id);
    return { ok: true, action: "created", ticketId: created.id, ticketNumber: created.number };
  } catch (err) {
    return { ok: false, reason: "error", detail: safeErrorMessage(err) };
  }
}

/**
 * Add an inbound message to an existing ticket. A client reply also un-parks the
 * ticket: a "waiting on client" status resumes the SLA clock, and a closed
 * ticket reopens, because a reply to a closed ticket is a live problem.
 */
async function appendToTicket(
  ticketId: string,
  ctx: {
    mailbox: SfMailbox;
    from: string;
    toAddresses: string[];
    ccAddresses: string[];
    input: InboundEmail;
    text: string;
    receivedAt: Date;
    rawJson: Prisma.InputJsonValue | undefined;
  },
): Promise<void> {
  const ticket = await prisma.sfTicket.findUnique({
    where: { id: ticketId },
    include: {
      status: true,
      board: { include: { statuses: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  if (!ticket) return;

  const reopenTarget =
    ticket.status.isClosed || ticket.status.stopsSlaClock
      ? (ticket.board.statuses.find((s) => s.isDefault && !s.isClosed && !s.stopsSlaClock) ??
        ticket.board.statuses.find((s) => s.isOpen && !s.isClosed && !s.stopsSlaClock) ??
        null)
      : null;

  // Resuming from a paused status banks the paused minutes so the SLA clock is
  // honest about how long we were waiting on the client.
  let slaPausedMinutes = ticket.slaPausedMinutes;
  if (reopenTarget && ticket.status.stopsSlaClock && ticket.slaPausedAt) {
    const sla = await loadSla(ticket.slaId);
    if (sla) slaPausedMinutes += pausedMinutesFor(sla, ticket.slaPausedAt, ctx.receivedAt);
  }
  const reopening = Boolean(reopenTarget) && ticket.status.isClosed;

  await prisma.$transaction(async (tx) => {
    await tx.sfTicketMessage.create({
      data: {
        ticketId,
        mailboxId: ctx.mailbox.id,
        direction: "INBOUND",
        fromAddress: textWrite(ctx.from) ?? ctx.from,
        toAddresses: ctx.toAddresses,
        ccAddresses: ctx.ccAddresses,
        subject: ctx.input.subject ?? null,
        bodyText: textWrite(ctx.text || null),
        bodyHtml: textWrite(ctx.input.html ?? null),
        messageId: ctx.input.messageId ?? null,
        inReplyTo: ctx.input.inReplyTo ?? null,
        references: ctx.input.references ?? null,
        externalId: ctx.input.externalId ?? null,
        receivedAt: ctx.receivedAt,
        ...(ctx.rawJson !== undefined ? { raw: ctx.rawJson } : {}),
      },
    });
    if (reopenTarget) {
      await tx.sfTicket.update({
        where: { id: ticketId },
        data: {
          statusId: reopenTarget.id,
          slaPausedAt: null,
          slaPausedMinutes,
          ...(reopening ? { closedAt: null } : {}),
        },
      });
      await tx.sfTicketHistory.create({
        data: {
          ticketId,
          field: "status",
          oldValue: ticket.status.name,
          newValue: reopenTarget.name,
          changedByEmail: ctx.from,
        },
      });
      await tx.sfSlaEvent.create({
        data: {
          ticketId,
          kind: reopening ? "REOPENED" : "RESUMED",
          note: `Client replied by email (${ctx.from})`,
        },
      });
    }
  });
}

/** How long a decision is kept. Long enough to investigate, short enough to bound. */
const EVENT_RETENTION_DAYS = 30;

/**
 * Record what happened to one message.
 *
 * Called by every ingest caller rather than from inside `ingestInboundEmail`,
 * which keeps that function a decision and this a side effect — and means the
 * webhook path cannot accidentally record differently from the poll.
 *
 * Never throws: losing the audit trail for a message must not also lose the
 * message. A failure here would otherwise turn a filed ticket into an error.
 */
export async function recordMailDecision(
  input: InboundEmail,
  outcome: IngestResult,
  mailboxId?: string | null,
): Promise<void> {
  try {
    await prisma.sfMailEvent.create({
      data: {
        // The webhook path does not know which mailbox the ingest settled on, so
        // attribute by address when it was not given. Deliberately lenient — this
        // is a label, not a routing decision, and a disabled mailbox is still the
        // right answer to "where did this arrive?".
        mailboxId: mailboxId ?? (await attributeMailbox(input.mailboxAddress ?? null)),
        decision: decisionOf(outcome),
        detail: outcome.ok ? null : (outcome.detail ?? null),
        // The sender is the single most useful field here — it is who to add as a
        // contact — and it is personal data, so it is stored the same way as
        // everywhere else.
        fromAddress: textWrite(normalizeAddress(input.from) ?? input.from),
        subject: input.subject ?? null,
        messageId: input.messageId ?? null,
        externalId: input.externalId ?? null,
        ticketId: outcome.ok ? outcome.ticketId : null,
        receivedAt: input.receivedAt ?? null,
      },
    });
  } catch {
    // Deliberately silent: see above.
  }
}

/** Best-effort mailbox for labelling an event, by polled or reply-as address. */
async function attributeMailbox(address: string | null): Promise<string | null> {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  const mailbox = await prisma.sfMailbox.findFirst({
    where: { OR: [{ address: normalized }, { sendAsAddress: normalized }] },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return mailbox?.id ?? null;
}

/** Drop decisions past the retention window. */
async function pruneMailEvents(): Promise<void> {
  const cutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    await prisma.sfMailEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  } catch {
    // Housekeeping — never worth failing a poll over.
  }
}

export interface MailboxPollResult {
  mailbox: string;
  ok: boolean;
  fetched: number;
  created: number;
  appended: number;
  deduped: number;
  skipped: Record<string, number>;
  error?: string;
}

/**
 * Poll one mailbox and file everything new. The watermark advances only past
 * messages we actually finished with, so an interrupted run re-reads rather than
 * loses mail (dedupe makes the re-read harmless).
 */
export async function pollMailbox(
  mailbox: SfMailbox,
  limit = 25,
): Promise<MailboxPollResult> {
  const result: MailboxPollResult = {
    mailbox: mailbox.address,
    ok: true,
    fetched: 0,
    created: 0,
    appended: 0,
    deduped: 0,
    skipped: {},
  };

  const fetched = await fetchMailboxMessages(mailbox, limit);
  if (!fetched.ok) {
    result.ok = false;
    result.error = fetched.error;
    await prisma.sfMailbox.update({
      where: { id: mailbox.id },
      data: { lastPolledAt: new Date(), lastPollError: fetched.error ?? "Unknown error" },
    });
    return result;
  }
  result.fetched = fetched.messages.length;

  let watermark = mailbox.lastMessageAt;
  for (const msg of fetched.messages) {
    const input = toInbound(mailbox, msg);
    const outcome = await ingestInboundEmail(input);
    await recordMailDecision(input, outcome, mailbox.id);
    if (outcome.ok) {
      if (outcome.action === "created") result.created += 1;
      else if (outcome.action === "appended") result.appended += 1;
      else result.deduped += 1;
      if (msg.externalId) await markMessageRead(mailbox, msg.externalId);
    } else {
      result.skipped[outcome.reason] = (result.skipped[outcome.reason] ?? 0) + 1;
    }
    // Advance past this message either way: a skipped message is a decision, not
    // a failure to process, and leaving it before the watermark would re-skip it
    // on every run forever.
    if (msg.receivedAt && (!watermark || msg.receivedAt > watermark)) watermark = msg.receivedAt;
  }

  await prisma.sfMailbox.update({
    where: { id: mailbox.id },
    data: { lastPolledAt: new Date(), lastMessageAt: watermark, lastPollError: null },
  });
  await pruneMailEvents();
  return result;
}

function toInbound(mailbox: SfMailbox, msg: FetchedMessage): InboundEmail {
  return {
    mailboxAddress: mailbox.address,
    from: msg.from,
    fromName: msg.fromName,
    to: msg.to,
    cc: msg.cc,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    messageId: msg.messageId,
    inReplyTo: msg.headers["in-reply-to"] ?? null,
    references: msg.headers["references"] ?? null,
    externalId: msg.externalId,
    receivedAt: msg.receivedAt,
    headers: msg.headers,
    ticketNumberHint: msg.ticketNumberHint,
    raw: msg.raw,
  };
}

/** Poll every active inbound mailbox. Failures are isolated per mailbox. */
export async function pollAllMailboxes(limitPerMailbox = 25): Promise<MailboxPollResult[]> {
  // Only Graph mailboxes can be polled. A Resend mailbox receives through the
  // inbound webhook instead, so skipping it here is correct — reporting it as a
  // failed poll every 15 minutes would be noise, not information.
  const mailboxes = await prisma.sfMailbox.findMany({
    where: { active: true, inbound: true, provider: "GRAPH" },
    orderBy: { createdAt: "asc" },
  });
  const results: MailboxPollResult[] = [];
  for (const mailbox of mailboxes) {
    try {
      results.push(await pollMailbox(mailbox, limitPerMailbox));
    } catch (err) {
      results.push({
        mailbox: mailbox.address,
        ok: false,
        fetched: 0,
        created: 0,
        appended: 0,
        deduped: 0,
        skipped: {},
        error: safeErrorMessage(err),
      });
    }
  }
  return results;
}
