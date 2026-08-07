import "server-only";
import { prisma } from "@/lib/db";
import { materializeClients } from "@/lib/mapping/service";
import { contactImportDecision, splitName } from "@/lib/silverfang/contacts";
import { contactWrite } from "@/lib/silverfang/pii";

/**
 * Import SuperOps clients + contacts into SilverFang.
 *
 * SilverFang uses the central `Client` as the single client identity, so
 * "importing clients" means guaranteeing every SuperOps client has a linked
 * `Client` — which `materializeClients` already does — and then bringing the
 * SuperOps contacts across as first-party `SfContact` records so tickets can have
 * real requesters.
 *
 * Idempotent: contacts upsert on (sourceSystem, externalId), so re-running
 * updates instead of duplicating. Records that can't be imported are counted and
 * reported rather than silently dropped.
 */

export const SUPEROPS_SOURCE = "SUPEROPS";

export interface ImportResult {
  /** SuperOps clients that now have a linked central Client. */
  clientsLinked: number;
  /** New central Clients created during materialization. */
  clientsCreated: number;
  /** Existing Clients matched to a SuperOps client by name. */
  clientsMatched: number;
  contactsImported: number;
  contactsUpdated: number;
  /** Contacts left alone because they were edited by hand in Wolf365. */
  contactsPreserved: number;
  /** Contacts skipped because their SuperOps client has no linked Client. */
  skippedNoClient: number;
  /** Contacts skipped because they have no usable name. */
  skippedNoName: number;
  /**
   * How many SuperOpsContact rows exist at all. Zero means the *connector* sync
   * brought none across, which is a different problem from an import that had
   * data and couldn't place it — and the two used to look identical ("0
   * contacts imported").
   */
  sourceContactsAvailable: number;
}

export async function importSuperOpsClients(actor: {
  id: string;
  email: string;
}): Promise<ImportResult> {
  // 1. Make sure every SuperOps client has a central Client. This is the existing
  //    materialization path (it links by normalized name, else creates one) — we
  //    deliberately don't reimplement client matching here.
  const materialized = await materializeClients(actor);

  // 2. Pull SuperOps clients that are linked, with their contacts.
  const soClients = await prisma.superOpsClient.findMany({
    where: { clientId: { not: null } },
    select: {
      clientId: true,
      contacts: {
        select: {
          superOpsId: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          lastSyncedAt: true,
        },
      },
    },
  });

  const result: ImportResult = {
    clientsLinked: soClients.length,
    clientsCreated: materialized.created,
    clientsMatched: materialized.merged,
    contactsImported: 0,
    contactsUpdated: 0,
    contactsPreserved: 0,
    skippedNoClient: 0,
    skippedNoName: 0,
    sourceContactsAvailable: await prisma.superOpsContact.count(),
  };

  // Contacts whose SuperOps client never materialized can't be placed.
  const orphanContacts = await prisma.superOpsContact.count({
    where: { superOpsClient: { clientId: null } },
  });
  result.skippedNoClient = orphanContacts;

  // 3. Upsert each contact by its source id.
  for (const so of soClients) {
    const clientId = so.clientId!;
    for (const c of so.contacts) {
      const parsed = splitName(c.name) ?? splitNameFromEmail(c.email);
      if (!parsed) {
        result.skippedNoName += 1;
        continue;
      }
      const secrets = contactWrite({ email: c.email, phone: c.phone });
      const data = {
        clientId,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        // Encrypted, with the email's lookup columns derived in the same write.
        // `mobile` is deliberately not copied across: SuperOps has no mobile
        // field, so writing it would wipe a number entered here by hand.
        email: secrets.email,
        phone: secrets.phone,
        emailIndex: secrets.emailIndex,
        emailDomain: secrets.emailDomain,
        title: c.role,
        sourceUpdatedAt: c.lastSyncedAt,
      };
      const existing = await prisma.sfContact.findUnique({
        where: {
          sourceSystem_externalId: {
            sourceSystem: SUPEROPS_SOURCE,
            externalId: c.superOpsId,
          },
        },
        select: { id: true, locallyModifiedAt: true },
      });
      switch (contactImportDecision(existing)) {
        case "preserve":
          // Edited by hand in Wolf365 — SilverFang is the source of truth now.
          result.contactsPreserved += 1;
          break;
        case "update":
          await prisma.sfContact.update({ where: { id: existing!.id }, data });
          result.contactsUpdated += 1;
          break;
        case "create":
          await prisma.sfContact.create({
            data: {
              ...data,
              sourceSystem: SUPEROPS_SOURCE,
              externalId: c.superOpsId,
            },
          });
          result.contactsImported += 1;
          break;
      }
    }
  }

  // 4. Give every client with contacts a primary, so ticket forms have a sensible
  //    default. Only fills the gap — never overrides an existing primary.
  await ensurePrimaryContacts();

  return result;
}

/** Last-resort name from an email local part ("sam.jones@x.com" → Sam Jones). */
function splitNameFromEmail(email: string | null | undefined) {
  if (!email) return null;
  const local = email.split("@")[0];
  if (!local) return null;
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return null;
  const titled = cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return splitName(titled);
}

/** Mark one contact primary per client that has none. */
async function ensurePrimaryContacts(): Promise<void> {
  const groups = await prisma.sfContact.groupBy({
    by: ["clientId"],
    where: { active: true },
    _count: { _all: true },
  });
  for (const g of groups) {
    const hasPrimary = await prisma.sfContact.count({
      where: { clientId: g.clientId, isPrimary: true },
    });
    if (hasPrimary > 0) continue;
    // Ordered by name, not email: the email column is ciphertext, so sorting on
    // it would pick an arbitrary contact rather than a predictable one.
    const first = await prisma.sfContact.findFirst({
      where: { clientId: g.clientId, active: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (first) {
      await prisma.sfContact.update({ where: { id: first.id }, data: { isPrimary: true } });
    }
  }
}

/** Human-readable summary of an import, for the action result message. */
export function describeImport(r: ImportResult): string {
  const parts = [
    `${r.clientsLinked} client${r.clientsLinked === 1 ? "" : "s"} linked`,
  ];
  // Say which of the two zero-contact situations this is, rather than reporting
  // "0 imported" and leaving the operator to guess where the data went.
  if (r.sourceContactsAvailable === 0) {
    if (r.clientsCreated > 0) parts.push(`${r.clientsCreated} created`);
    if (r.clientsMatched > 0) parts.push(`${r.clientsMatched} matched by name`);
    return (
      `${parts.join(", ")}. No contacts were imported because Wolf365 has no SuperOps ` +
      `contacts stored — the SuperOps sync itself brought none across. Check Connector ` +
      `Data → Debug Logs for the "sync_contacts" entry: it records how many records the ` +
      `API returned and how many were skipped.`
    );
  }
  if (r.clientsCreated > 0) parts.push(`${r.clientsCreated} created`);
  if (r.clientsMatched > 0) parts.push(`${r.clientsMatched} matched by name`);
  parts.push(`${r.contactsImported} contact${r.contactsImported === 1 ? "" : "s"} imported`);
  if (r.contactsUpdated > 0) parts.push(`${r.contactsUpdated} updated`);
  if (r.contactsPreserved > 0) {
    parts.push(`${r.contactsPreserved} left as edited in Wolf365`);
  }
  if (r.skippedNoClient > 0) {
    parts.push(`${r.skippedNoClient} contact(s) skipped (client not linked)`);
  }
  if (r.skippedNoName > 0) parts.push(`${r.skippedNoName} skipped (no name)`);
  return `${parts.join(", ")}.`;
}
