import "server-only";
import { prisma } from "@/lib/db";
import { textRead } from "@/lib/silverfang/pii";
import { normalizeAddress } from "@/lib/silverfang/email";
import { nameFromAddress } from "@/lib/silverfang/contacts";
import {
  autoCreateContactForAddress,
  contactExistsFor,
} from "@/lib/silverfang/contact-domain";
import {
  groupUnknownSenders,
  suggestClientForDomain,
  type SenderGroup,
  type Suggestion,
} from "@/lib/silverfang/sender-match";

/**
 * Clearing the unrecognised-sender list.
 *
 * A refused message names a person nobody has on file. The fix is always the same
 * — make them a contact on the right client — so this turns that into one action
 * per sender, taken from the mail log itself. The email address is enough: the
 * name is derived from it, everything else on a contact is optional.
 *
 * What it does NOT do is retry the message. The poll watermark has already moved
 * past it, so the refused message will not be fetched again; adding the contact
 * fixes the *next* mail from that sender. That is stated in the UI rather than
 * left to be discovered.
 */

const UNKNOWN_SENDER = "unknown-sender";

/** How far back to look. Mail events are pruned at 30 days anyway. */
const SCAN_LIMIT = 2_000;

export interface TriageRow extends SenderGroup {
  /** The client to offer, or null when nothing matched or two things matched. */
  suggestion: Suggestion | null;
  /** False when no name can be derived — `noreply@`, digits only. */
  nameable: boolean;
}

export interface TriageData {
  rows: TriageRow[];
  clients: { id: string; name: string }[];
}

/**
 * Every sender the ingest refused, grouped, with a client suggested for each.
 *
 * The address column is encrypted, so the rows are read and decrypted rather than
 * filtered in SQL — hence the bound.
 */
export async function unrecognisedSenders(): Promise<TriageData> {
  const [events, clients, superOps] = await Promise.all([
    prisma.sfMailEvent.findMany({
      where: { decision: UNKNOWN_SENDER, fromAddress: { not: null } },
      orderBy: { createdAt: "desc" },
      take: SCAN_LIMIT,
      select: {
        fromAddress: true,
        subject: true,
        createdAt: true,
        receivedAt: true,
        mailbox: { select: { address: true } },
      },
    }),
    prisma.client.findMany({
      where: { archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 2_000,
    }),
    // Domains a client declares in SuperOps. Recorded fact about the account, so
    // it outranks every kind of name matching.
    prisma.superOpsClient.findMany({
      where: { clientId: { not: null } },
      select: { clientId: true, emailDomains: true },
    }),
  ]);

  const domainOwners: Record<string, string> = {};
  for (const so of superOps) {
    for (const domain of so.emailDomains) {
      const key = domain.trim().toLowerCase();
      // First writer wins, so two clients claiming a domain cannot make the
      // suggestion depend on row order.
      if (key && !domainOwners[key]) domainOwners[key] = so.clientId!;
    }
  }

  const groups = groupUnknownSenders(
    events.map((e) => ({
      address: normalizeAddress(textRead(e.fromAddress)) ?? "",
      subject: e.subject ? textRead(e.subject) : null,
      at: e.receivedAt ?? e.createdAt,
      mailbox: e.mailbox?.address ?? null,
    })),
  );

  // Someone added by hand (or by an earlier click) is no longer outstanding, even
  // though their old refusals are still in the log.
  const rows: TriageRow[] = [];
  for (const group of groups) {
    if (await contactExistsFor(group.address)) continue;
    rows.push({
      ...group,
      suggestion: suggestClientForDomain({
        domain: group.domain,
        clients,
        domainOwners,
      }),
      nameable: nameFromAddress(group.address) != null,
    });
  }

  return { rows, clients };
}

export interface AdoptResult {
  ok: boolean;
  message: string;
}

/**
 * Make one refused sender a contact on a client.
 *
 * Goes through `autoCreateContactForAddress`, the same helper the live ingest and
 * the backfill use — so the address is encrypted, the blind index and domain are
 * derived in the same write (which is what makes their *next* message match by
 * address), and provenance is stamped EMAIL/<address> so a re-run cannot duplicate.
 */
export async function adoptSender(input: {
  address: string;
  clientId: string;
}): Promise<AdoptResult> {
  const address = normalizeAddress(input.address);
  if (!address) return { ok: false, message: "That is not a usable email address." };

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, archived: false },
    select: { id: true, name: true },
  });
  if (!client) return { ok: false, message: "That client no longer exists." };

  if (await contactExistsFor(address)) {
    return { ok: true, message: `${address} already has a contact — nothing to do.` };
  }
  if (!nameFromAddress(address)) {
    return {
      ok: false,
      message:
        `No name can be derived from ${address}, so a contact would have a blank name. ` +
        `Create it by hand from the client page if you want it.`,
    };
  }

  const contactId = await autoCreateContactForAddress(address, null, client.id);
  if (!contactId) {
    return { ok: false, message: `Could not create a contact for ${address}.` };
  }
  return {
    ok: true,
    message:
      `${address} added to ${client.name}. Their next email opens a ticket against that ` +
      `client — the messages already refused are not retried.`,
  };
}

export interface AdoptAllResult {
  added: number;
  skipped: number;
  clients: string[];
}

/**
 * Adopt every sender that has a suggestion, onto the suggested client.
 *
 * Re-derives the suggestions server-side rather than accepting a list from the
 * browser: which person lands on which company must not be decided by a stale
 * page.
 *
 * Only `domain` and `name` tier suggestions are taken. `partial` is a guess by
 * construction, and a guess applied in bulk to twenty senders is how a dozen
 * people end up on the wrong company at once.
 */
export async function adoptAllSuggested(): Promise<AdoptAllResult> {
  const { rows } = await unrecognisedSenders();
  const result: AdoptAllResult = { added: 0, skipped: 0, clients: [] };
  const clientNames = new Set<string>();

  for (const row of rows) {
    const tier = row.suggestion?.tier;
    if (!row.suggestion || tier === "partial" || !row.nameable) {
      result.skipped += 1;
      continue;
    }
    // Sequential: each creation makes its domain matchable, which changes what a
    // later sender on the same domain resolves to.
    const outcome = await adoptSender({
      address: row.address,
      clientId: row.suggestion.clientId,
    });
    if (outcome.ok) {
      result.added += 1;
      clientNames.add(row.suggestion.clientName);
    } else {
      result.skipped += 1;
    }
  }

  result.clients = [...clientNames].sort();
  return result;
}

/** Plain-English summary of a bulk adopt, with the skips said out loud. */
export function describeAdoptAll(r: AdoptAllResult): string {
  if (r.added === 0) {
    return r.skipped === 0
      ? "No unrecognised senders left to add."
      : `Nothing added. ${r.skipped} sender(s) had no confident client match — pick one for each below.`;
  }
  const parts = [
    `${r.added} contact${r.added === 1 ? "" : "s"} added across ${r.clients.length} client(s)`,
  ];
  if (r.skipped > 0) {
    parts.push(`${r.skipped} left for you — either no match, an uncertain one, or no usable name`);
  }
  return `${parts.join("; ")}. Refused messages are not retried; the next email from each sender opens a ticket.`;
}
