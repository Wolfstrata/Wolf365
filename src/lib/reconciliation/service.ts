import "server-only";
import type { ExceptionType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  detectDiscrepancies,
  type AddressLike,
} from "@/lib/reconciliation/discrepancies";

/** Exception types produced by discrepancy detection (vs. billing generation). */
const DISCREPANCY_TYPES: ExceptionType[] = [
  "NAME_MISMATCH",
  "ADDRESS_MISMATCH",
  "MISSING_BILLING_EMAIL",
  "CLIENT_ONLY_IN_QBO",
  "CLIENT_ONLY_IN_TDSYNNEX",
  "ACTIVE_STATUS_MISMATCH",
  "CURRENCY_MISMATCH",
  "TAX_MISMATCH",
];

/**
 * Discrepancy types the user has chosen to auto-clear: they are too noisy to be
 * actionable in the queue (missing billing email, and fuzzy name/address
 * mismatches). They are still detected — so they can show inline on a client's
 * profile — but never surfaced as open exceptions, and any lingering open ones
 * are purged on every reconciliation run.
 */
const AUTO_CLEARED_TYPES: ExceptionType[] = [
  "MISSING_BILLING_EMAIL",
  "NAME_MISMATCH",
  "ADDRESS_MISMATCH",
];

/**
 * Scan every client with at least one source record, run discrepancy detection,
 * and refresh the open discrepancy exceptions in the queue. Existing open
 * discrepancy exceptions are cleared first so resolved issues disappear and the
 * queue reflects current state (idempotent).
 */
export async function reconcileAllClients(actor: {
  id: string | null;
  email: string;
}): Promise<{ scanned: number; flagged: number; suppressed: number }> {
  const clients = await prisma.client.findMany({
    include: { qboCustomer: true, tdSynnexCustomer: true },
  });

  // Group awareness: a client can be a parent or a subsidiary. When a client is
  // missing one source (e.g. no TD SYNNEX) but a related company in the same
  // group HAS it, the licensing legitimately flows through the group — so don't
  // flag "only in QBO"/"only in TD SYNNEX" as a discrepancy.
  const hasQbo = new Map<string, boolean>();
  const hasTd = new Map<string, boolean>();
  const childrenOf = new Map<string, string[]>();
  for (const c of clients) {
    hasQbo.set(c.id, !!c.qboCustomer);
    hasTd.set(c.id, !!c.tdSynnexCustomer);
    if (c.parentClientId) {
      const arr = childrenOf.get(c.parentClientId) ?? [];
      arr.push(c.id);
      childrenOf.set(c.parentClientId, arr);
    }
  }
  const groupHas = (
    clientId: string,
    parentClientId: string | null,
    map: Map<string, boolean>,
  ): boolean => {
    const root = parentClientId ?? clientId; // parent + its subsidiaries form the group
    if (map.get(root)) return true;
    for (const child of childrenOf.get(root) ?? []) {
      if (child !== clientId && map.get(child)) return true;
    }
    return false;
  };

  // Respect manual decisions: a discrepancy the user acknowledged or resolved is
  // not recreated on the next run (keyed by client + type).
  const dismissed = await prisma.exception.findMany({
    where: { type: { in: DISCREPANCY_TYPES }, status: { in: ["ACKNOWLEDGED", "RESOLVED"] } },
    select: { clientId: true, type: true },
  });
  const dismissedKey = new Set(dismissed.map((d) => `${d.clientId}:${d.type}`));

  const toCreate: Prisma.ExceptionCreateManyInput[] = [];
  let suppressed = 0;

  for (const client of clients) {
    const qbo = client.qboCustomer;
    const td = client.tdSynnexCustomer;
    if (!qbo && !td) continue;

    const discrepancies = detectDiscrepancies({
      qbo: qbo
        ? {
            displayName: qbo.displayName,
            companyName: qbo.companyName,
            billingEmail: qbo.billingEmail,
            billingAddress: qbo.billingAddress as AddressLike | null,
            currency: qbo.currency,
            taxable: qbo.taxable,
            active: qbo.active,
          }
        : null,
      td: td
        ? {
            name: td.name,
            domain: td.domain,
            serviceAddress: td.serviceAddress as AddressLike | null,
            active: td.active,
          }
        : null,
    });

    for (const d of discrepancies) {
      // Auto-cleared types never enter the queue (see AUTO_CLEARED_TYPES).
      if (AUTO_CLEARED_TYPES.includes(d.type)) {
        suppressed += 1;
        continue;
      }
      if (
        (d.type === "CLIENT_ONLY_IN_QBO" && groupHas(client.id, client.parentClientId, hasTd)) ||
        (d.type === "CLIENT_ONLY_IN_TDSYNNEX" && groupHas(client.id, client.parentClientId, hasQbo))
      ) {
        suppressed += 1;
        continue;
      }
      if (dismissedKey.has(`${client.id}:${d.type}`)) continue;
      toCreate.push({
        type: d.type,
        severity: d.severity,
        clientId: client.id,
        message: d.message,
        details: {} as Prisma.InputJsonValue,
      });
    }
  }

  // One delete + one insert instead of a transaction per client — fast enough to
  // finish well within the function budget even for thousands of clients.
  await prisma.$transaction([
    prisma.exception.deleteMany({
      where: { status: "OPEN", type: { in: DISCREPANCY_TYPES } },
    }),
    // Auto-cleared types: purge any non-resolved rows (incl. acknowledged) so
    // they disappear from the queue entirely and stay gone.
    prisma.exception.deleteMany({
      where: { type: { in: AUTO_CLEARED_TYPES }, status: { not: "RESOLVED" } },
    }),
    prisma.exception.createMany({ data: toCreate }),
  ]);

  await audit({
    action: "MAPPING_CHANGED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: "reconciliation:run",
    metadata: { scanned: clients.length, flagged: toCreate.length, suppressed },
  });

  return { scanned: clients.length, flagged: toCreate.length, suppressed };
}
