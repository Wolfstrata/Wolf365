import "server-only";
import { prisma } from "@/lib/db";
import { textRead } from "@/lib/silverfang/pii";
import { addressDomain, isPublicEmailDomain, normalizeAddress } from "@/lib/silverfang/email";
import { nameFromAddress } from "@/lib/silverfang/contacts";
import {
  autoCreateContactForAddress,
  contactExistsFor,
  domainClientFor,
} from "@/lib/silverfang/contact-domain";

/**
 * Backfill contacts for addresses that were already received.
 *
 * Domain matching was added after mail had been flowing for a while, so senders
 * who would be auto-created today are sitting in the history with no contact
 * record. This walks what we have and runs them through the same
 * `domainClientFor` / `autoCreateContactForAddress` pair the live ingest uses —
 * identical rules, so an address matched here lands on the same client it would
 * have live.
 *
 * Two sources, because they answer different questions:
 *  - `SfTicketMessage` (inbound): everyone who ever emailed a ticket. Permanent.
 *  - `SfMailEvent`: including the ones that were *skipped* as unknown-sender,
 *    which is exactly the population this is for. Pruned at 30 days, so it only
 *    covers recent history — said out loud in the result rather than implied.
 *
 * Both address columns are encrypted, so there is no way to filter in SQL: the
 * rows are read and decrypted. Hence the bound.
 */

/** Rows read per source. High enough for real history, low enough to finish. */
const SCAN_LIMIT = 20_000;

export interface BackfillOutcome {
  /** Distinct addresses examined. */
  addresses: number;
  created: number;
  /** Already had a contact — nothing to do. */
  alreadyKnown: number;
  /** No other contact shares the domain, so there is no client to attach them to. */
  noDomainMatch: number;
  /** gmail.com and friends: not a company, never domain-matched. */
  publicDomain: number;
  /** No name could be derived from the address (e.g. `noreply@`, digits only). */
  noName: number;
  /** Matched a client but the write failed. Counted, not swallowed. */
  failed: number;
  /** Whether either source hit the scan bound, so a second run would find more. */
  truncated: boolean;
  /** What was created, for the audit metadata. */
  contacts: { address: string; clientName: string }[];
}

/**
 * Every distinct inbound address we hold, newest first.
 *
 * Deliberately not deduped by lower-casing alone: `normalizeAddress` is what the
 * blind index uses, so dedupe must agree with it or the same person is processed
 * twice and the second attempt collides on the unique constraint.
 */
async function inboundAddresses(): Promise<{ addresses: string[]; truncated: boolean }> {
  const [messages, events] = await Promise.all([
    prisma.sfTicketMessage.findMany({
      where: { direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
      take: SCAN_LIMIT,
      select: { fromAddress: true },
    }),
    prisma.sfMailEvent.findMany({
      where: { fromAddress: { not: null } },
      orderBy: { createdAt: "desc" },
      take: SCAN_LIMIT,
      select: { fromAddress: true },
    }),
  ]);

  const seen = new Set<string>();
  for (const row of [...messages, ...events]) {
    // Stored encrypted; `textRead` is plaintext-tolerant, so rows written before
    // encryption was switched on still read.
    const address = normalizeAddress(textRead(row.fromAddress));
    if (address) seen.add(address);
  }

  return {
    addresses: [...seen],
    truncated: messages.length === SCAN_LIMIT || events.length === SCAN_LIMIT,
  };
}

/**
 * Run the backfill.
 *
 * Sequential rather than parallel: each creation changes what the *next* address
 * matches (creating a contact on a new domain makes that domain matchable), and
 * running them concurrently would make the result depend on timing.
 */
export async function backfillDomainContacts(): Promise<BackfillOutcome> {
  const { addresses, truncated } = await inboundAddresses();
  const outcome: BackfillOutcome = {
    addresses: addresses.length,
    created: 0,
    alreadyKnown: 0,
    noDomainMatch: 0,
    publicDomain: 0,
    noName: 0,
    failed: 0,
    truncated,
    contacts: [],
  };

  // Client names are only needed for the ones we create; cached so a domain with
  // twenty new senders costs one lookup.
  const clientNames = new Map<string, string>();

  for (const address of addresses) {
    if (await contactExistsFor(address)) {
      outcome.alreadyKnown += 1;
      continue;
    }
    const domain = addressDomain(address);
    if (!domain || isPublicEmailDomain(domain)) {
      outcome.publicDomain += 1;
      continue;
    }
    // Checked before matching so `noName` is reported as its own reason rather
    // than showing up as a mysterious failure after a successful match.
    if (!nameFromAddress(address)) {
      outcome.noName += 1;
      continue;
    }
    const clientId = await domainClientFor(address);
    if (!clientId) {
      outcome.noDomainMatch += 1;
      continue;
    }
    // No display name is available here: the stored rows keep the address, not the
    // sender's own name, so the name comes from the address.
    const contactId = await autoCreateContactForAddress(address, null, clientId);
    if (!contactId) {
      outcome.failed += 1;
      continue;
    }
    if (!clientNames.has(clientId)) {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: { name: true },
      });
      clientNames.set(clientId, client?.name ?? clientId);
    }
    outcome.created += 1;
    outcome.contacts.push({ address, clientName: clientNames.get(clientId)! });
  }

  return outcome;
}

/** Plain-English summary, with every skip reason named. */
export function describeBackfill(o: BackfillOutcome): string {
  if (o.addresses === 0) {
    return "No inbound email addresses on file yet, so there was nothing to match.";
  }
  const parts = [`${o.created} contact${o.created === 1 ? "" : "s"} created`];
  parts.push(`${o.alreadyKnown} already known`);
  if (o.noDomainMatch > 0) parts.push(`${o.noDomainMatch} on domains no client owns`);
  if (o.publicDomain > 0) parts.push(`${o.publicDomain} on consumer domains`);
  if (o.noName > 0) parts.push(`${o.noName} with no usable name`);
  if (o.failed > 0) parts.push(`${o.failed} failed to write`);
  let text = `${parts.join(", ")}, from ${o.addresses} distinct address${
    o.addresses === 1 ? "" : "es"
  }.`;
  if (o.truncated) {
    text += ` Only the most recent ${SCAN_LIMIT.toLocaleString()} messages per source were scanned — run it again to continue.`;
  }
  if (o.noDomainMatch > 0) {
    text +=
      " Addresses on domains no client owns need one contact on that domain first;" +
      " add it and re-run, and the rest of the domain follows.";
  }
  return text;
}
