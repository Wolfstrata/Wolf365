import "server-only";
import { prisma } from "@/lib/db";
import { contactEmailIndex, contactWrite } from "@/lib/silverfang/pii";
import { nameFromAddress, splitName } from "@/lib/silverfang/contacts";
import { addressDomain, isPublicEmailDomain } from "@/lib/silverfang/email";

/**
 * Domain-matching an unknown sender to a client, and recording them as a contact.
 *
 * Lives here rather than inside the mail ingest because two callers need the
 * identical behaviour: live ingest, and the backfill that walks addresses already
 * received. If those two ever diverged, the backfill would create contacts the
 * live path would not — or worse, attach people to the wrong client.
 */

/** Provenance for contacts the mail path created, distinct from an import. */
export const AUTO_CONTACT_SOURCE = "EMAIL";

/** How many contacts on a domain to sample when deciding which client owns it. */
const PEER_SAMPLE = 200;

/**
 * The client that owns an address's domain, judged by who already has contacts
 * there.
 *
 * Consumer domains are never matched: gmail.com is not a company, and one
 * gmail contact would otherwise claim every future gmail sender.
 *
 * Returns null when nothing matches. That is the honest answer — the caller must
 * not fall back to a guess, because a wrong client on a contact is worse than no
 * contact.
 */
export async function domainClientFor(address: string): Promise<string | null> {
  const domain = addressDomain(address);
  if (!domain || isPublicEmailDomain(domain)) return null;

  const peers = await prisma.sfContact.findMany({
    where: {
      // Matched on the domain column, kept in the clear precisely so this
      // fallback still works with the address itself encrypted.
      emailDomain: domain,
      active: true,
      client: { archived: false },
    },
    select: { clientId: true },
    take: PEER_SAMPLE,
  });
  if (peers.length === 0) return null;

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
  return bestId;
}

/**
 * Create a contact for a sender matched by domain.
 *
 * The company is known — other contacts share this domain — but the person is
 * not. Recording them turns a one-off match into a real requester: the next
 * message matches by address instead of by domain, a reply has somewhere to go,
 * and the ticket shows who raised it.
 *
 * Provenance is stamped as EMAIL/<address>, which the (sourceSystem, externalId)
 * unique constraint turns into idempotency — two messages racing in from the same
 * new sender cannot produce two contacts.
 *
 * Never throws. A contact we failed to create must not cost the caller its
 * ticket; the ticket is simply filed without a requester.
 */
export async function autoCreateContactForAddress(
  address: string,
  fromName: string | null,
  clientId: string,
): Promise<string | null> {
  try {
    // The display name the sender's own mail client set is better than anything
    // derived from the address, so it wins when present.
    const parsed = splitName(fromName) ?? nameFromAddress(address);
    if (!parsed) return null;

    const created = await prisma.sfContact.create({
      data: {
        clientId,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        // Encrypted, with the blind index and domain derived in the same write —
        // the index is what makes the NEXT message from them match by address.
        ...contactWrite({ email: address }),
        sourceSystem: AUTO_CONTACT_SOURCE,
        externalId: address,
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
    // same sender. Look up whoever won the race so the caller still gets them.
    const existing = await prisma.sfContact
      .findFirst({ where: { emailIndex: contactEmailIndex(address) }, select: { id: true } })
      .catch(() => null);
    return existing?.id ?? null;
  }
}

/** Whether an address already belongs to a contact. */
export async function contactExistsFor(address: string): Promise<boolean> {
  const hit = await prisma.sfContact.findFirst({
    where: { emailIndex: contactEmailIndex(address) },
    select: { id: true },
  });
  return hit != null;
}
