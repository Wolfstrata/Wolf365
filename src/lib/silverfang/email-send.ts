import "server-only";
import { prisma } from "@/lib/db";
import {
  buildOutboundSubject,
  buildReferences,
  outboundAddress,
  parseAddressList,
  textToHtml,
  withSignature,
} from "@/lib/silverfang/email";
import { loadEmailPolicy, resolveOutboundMailbox, sendTicketMail } from "@/lib/silverfang/mail";
import { decideOutbound } from "@/lib/silverfang/email-policy";

/**
 * Outbound ticket email. Sends first, records second — a message row is only
 * written when the provider actually accepted the mail, so the ticket timeline
 * never claims a reply the client never got.
 */

export interface SendReplyInput {
  ticketId: string;
  to: string[];
  cc?: string[];
  /** Optional subject override; defaults to the ticket summary. */
  subject?: string | null;
  body: string;
  actor: { id: string | null; email: string };
}

export interface SendReplyResult {
  ok: boolean;
  message: string;
  /** True when this send satisfied the SLA response target. */
  firstResponse?: boolean;
}

/** Default recipients for a reply: the contact, else the last inbound sender. */
export async function defaultReplyRecipients(ticketId: string): Promise<string[]> {
  const ticket = await prisma.sfTicket.findUnique({
    where: { id: ticketId },
    select: { contact: { select: { email: true } } },
  });
  if (ticket?.contact?.email) return parseAddressList([ticket.contact.email]);
  const lastInbound = await prisma.sfTicketMessage.findFirst({
    where: { ticketId, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
    select: { fromAddress: true },
  });
  return lastInbound ? parseAddressList([lastInbound.fromAddress]) : [];
}

/**
 * Reply to a ticket by email. The first outbound message to a client also
 * satisfies the SLA response target — the same rule the first client-visible
 * note follows, so response time means one thing across the product.
 */
export async function sendTicketReply(input: SendReplyInput): Promise<SendReplyResult> {
  const to = parseAddressList(input.to);
  if (to.length === 0) {
    return { ok: false, message: "Add at least one valid recipient address." };
  }
  const cc = parseAddressList(input.cc ?? []);
  const body = input.body.trim();
  if (!body) return { ok: false, message: "The message body is empty." };

  const ticket = await prisma.sfTicket.findUnique({
    where: { id: input.ticketId },
    select: {
      id: true,
      number: true,
      summary: true,
      firstRespondedAt: true,
      clientId: true,
      client: {
        select: { name: true, sfClientProfile: { select: { allowClientEmail: true } } },
      },
    },
  });
  if (!ticket) return { ok: false, message: "That ticket no longer exists." };

  // Checked here as well as in the transport: the transport is the guarantee, this
  // is so the composer reports the reason before anything else happens.
  const decision = decideOutbound({
    policy: await loadEmailPolicy(),
    audience: "CLIENT",
    clientProfile: ticket.client.sfClientProfile,
    clientName: ticket.client.name,
  });
  if (!decision.allowed) return { ok: false, message: decision.message };

  // Thread onto the most recent message we know about, in the order a mail
  // client expects.
  const last = await prisma.sfTicketMessage.findFirst({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: "desc" },
    select: { messageId: true, references: true, mailboxId: true },
  });
  const mailbox = await resolveOutboundMailbox(last?.mailboxId ?? null);
  if (!mailbox) {
    return {
      ok: false,
      message:
        "No active outbound mailbox is configured — add one under SilverFang → Email first.",
    };
  }

  const fromAddress = outboundAddress(mailbox);
  const subject = buildOutboundSubject(ticket.number, input.subject?.trim() || ticket.summary, {
    reply: Boolean(last),
  });
  const fullBody = withSignature(body, mailbox.signature);
  const references = buildReferences(last?.references, last?.messageId);

  const sent = await sendTicketMail(mailbox, {
    to,
    cc,
    subject,
    text: fullBody,
    html: textToHtml(fullBody),
    ticketNumber: ticket.number,
    inReplyTo: last?.messageId ?? null,
    references,
    audience: { kind: "CLIENT", clientId: ticket.clientId },
  });
  if (!sent.sent) {
    return { ok: false, message: sent.reason ?? "The mail provider rejected the message." };
  }

  const firstResponse = ticket.firstRespondedAt == null;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.sfTicketMessage.create({
      data: {
        ticketId: ticket.id,
        mailboxId: mailbox.id,
        direction: "OUTBOUND",
        fromAddress,
        toAddresses: to,
        ccAddresses: cc,
        subject,
        bodyText: fullBody,
        bodyHtml: textToHtml(fullBody),
        inReplyTo: last?.messageId ?? null,
        references,
        sentAt: now,
        ...(sent.providerId ? { externalId: sent.providerId } : {}),
      },
    });
    if (firstResponse) {
      await tx.sfTicket.update({
        where: { id: ticket.id },
        data: { firstRespondedAt: now },
      });
      await tx.sfSlaEvent.create({
        data: {
          ticketId: ticket.id,
          kind: "RESPONDED",
          targetKind: "RESPONSE",
          note: `Emailed ${to.join(", ")} by ${input.actor.email}`,
        },
      });
    }
  });

  return {
    ok: true,
    firstResponse,
    message: `Email sent to ${to.join(", ")}${
      firstResponse ? " — recorded as the SLA first response." : "."
    }`,
  };
}
