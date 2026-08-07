import "server-only";
import { prisma } from "@/lib/db";
import { getEnv } from "@/env";
import { safeErrorMessage } from "@/lib/redact";
import {
  buildOutboundSubject,
  outboundAddress,
  renderTemplate,
  textToHtml,
  withSignature,
} from "@/lib/silverfang/email";
import {
  resolveOutboundMailbox,
  sendTicketMail,
  type MailAudience,
} from "@/lib/silverfang/mail";
import { textRead, textWrite } from "@/lib/silverfang/pii";

/**
 * Auto-response rules: templated mail sent to the contact and/or the assignee
 * when something happens on a ticket.
 *
 * Two safety rules that are not negotiable:
 *  1. Nothing is sent in reply to machine-generated mail (`suppress`), or two
 *     robots will mail each other until someone notices the bill.
 *  2. A send failure is swallowed and reported, never thrown — an
 *     acknowledgement that cannot go out must not roll back the ticket the
 *     client just raised.
 */

export type AutoResponseTrigger =
  | "TICKET_CREATED"
  | "STATUS_CHANGED"
  | "NOTE_ADDED"
  | "SLA_BREACHED";

export interface AutoResponseOutcome {
  rule: string;
  sent: boolean;
  to: string[];
  reason?: string;
}

/** Absolute link to a ticket, for use in templates. */
function ticketUrl(ticketId: string): string | null {
  const base = getEnv().AUTH_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/silverfang/tickets/${ticketId}`;
}

/**
 * Run every active rule for a trigger. Returns what happened per rule so callers
 * (and the cron summary) can report honestly instead of assuming mail went out.
 */
export async function runAutoResponses(
  trigger: AutoResponseTrigger,
  ticketId: string,
  opts: { suppress?: boolean } = {},
): Promise<AutoResponseOutcome[]> {
  if (opts.suppress) return [];

  try {
    const rules = await prisma.sfAutoResponseRule.findMany({
      where: { active: true, trigger },
      orderBy: { name: "asc" },
    });
    if (rules.length === 0) return [];

    const ticket = await prisma.sfTicket.findUnique({
      where: { id: ticketId },
      include: {
        client: {
          select: {
            name: true,
            sfClientProfile: { select: { allowClientEmail: true } },
          },
        },
        contact: { select: { firstName: true, lastName: true, email: true } },
        status: { select: { id: true, name: true } },
        assignee: { select: { name: true, email: true } },
        board: { select: { id: true, name: true } },
      },
    });
    if (!ticket) return [];

    const mailbox = await resolveOutboundMailbox();
    const vars = {
      "ticket.number": ticket.number,
      "ticket.summary": ticket.summary,
      "ticket.status": ticket.status.name,
      "ticket.priority": ticket.priority,
      "ticket.url": ticketUrl(ticket.id),
      "client.name": ticket.client.name,
      "contact.firstName": ticket.contact?.firstName ?? null,
      "contact.name": ticket.contact
        ? [ticket.contact.firstName, ticket.contact.lastName].filter(Boolean).join(" ")
        : null,
      "assignee.name": ticket.assignee?.name ?? ticket.assignee?.email ?? null,
      "mailbox.name": mailbox?.name ?? mailbox?.address ?? null,
    };

    const outcomes: AutoResponseOutcome[] = [];
    for (const rule of rules) {
      // Optional narrowing — a rule with no board/status/priority matches all.
      if (rule.boardId && rule.boardId !== ticket.boardId) continue;
      if (rule.statusId && rule.statusId !== ticket.statusId) continue;
      if (rule.priority && rule.priority !== ticket.priority) continue;

      // Client and internal recipients are sent separately: a client who has not
      // opted in must not be mailed, but that must not also silence the
      // technician notice on the same rule.
      const clientTo: string[] = [];
      const internalTo: string[] = [];
      if (rule.audience === "CONTACT" || rule.audience === "BOTH") {
        // Stored encrypted — decrypt, or the "address" handed to the mail
        // transport would be a ciphertext string.
        const contactEmail = textRead(ticket.contact?.email);
        if (contactEmail) clientTo.push(contactEmail);
      }
      if (rule.audience === "ASSIGNEE" || rule.audience === "BOTH") {
        if (ticket.assignee?.email) internalTo.push(ticket.assignee.email);
      }
      if (clientTo.length === 0 && internalTo.length === 0) {
        outcomes.push({
          rule: rule.name,
          sent: false,
          to: [],
          reason: "No recipient for this audience",
        });
        continue;
      }
      if (!mailbox) {
        outcomes.push({
          rule: rule.name,
          sent: false,
          to: [...clientTo, ...internalTo],
          reason: "No active outbound mailbox is configured",
        });
        continue;
      }

      const body = withSignature(renderTemplate(rule.bodyTemplate, vars), mailbox.signature);
      const subject = renderTemplate(rule.subjectTemplate, vars);
      const fullSubject = buildOutboundSubject(ticket.number, subject);

      const fromAddr = outboundAddress(mailbox);
      const deliver = async (to: string[], audience: MailAudience) => {
        if (to.length === 0) return;
        const result = await sendTicketMail(mailbox, {
          to,
          subject: fullSubject,
          text: body,
          html: textToHtml(body),
          ticketNumber: ticket.number,
          audience,
        });
        if (result.sent) {
          await prisma.sfTicketMessage.create({
            data: {
              ticketId: ticket.id,
              mailboxId: mailbox.id,
              direction: "OUTBOUND",
              fromAddress: textWrite(fromAddr) ?? fromAddr,
              toAddresses: to,
              subject: fullSubject,
              bodyText: textWrite(body),
              bodyHtml: textWrite(textToHtml(body)),
              sentAt: new Date(),
            },
          });
        }
        outcomes.push({
          rule: rule.name,
          sent: result.sent,
          to,
          ...(result.reason ? { reason: result.reason } : {}),
        });
      };

      await deliver(clientTo, { kind: "CLIENT", clientId: ticket.clientId });
      await deliver(internalTo, { kind: "INTERNAL" });
    }
    return outcomes;
  } catch (err) {
    // Never let an auto-response failure break the operation that triggered it.
    return [{ rule: "(auto-responses)", sent: false, to: [], reason: safeErrorMessage(err) }];
  }
}
