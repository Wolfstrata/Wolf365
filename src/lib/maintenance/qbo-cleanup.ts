import "server-only";
import { prisma } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";

/**
 * Remove QuickBooks data that does NOT belong to the connected PRODUCTION
 * company — i.e. leftover sandbox/test records. Everything is keyed off the
 * production realm id (read from the encrypted connector secrets), so the live
 * production data is never touched.
 *
 * Removes: QboCustomer / QboItem rows from any non-production realm, plus the
 * Client master records that were materialized ONLY from those sandbox
 * customers (no other source, and no billing / CRM / SuperOps history). Clients
 * with any real business data are kept and counted.
 */
export interface QboCleanupResult {
  ok: boolean;
  message: string;
  productionRealmId?: string;
  customersDeleted: number;
  itemsDeleted: number;
  clientsDeleted: number;
  clientsKept: number;
}

/** Read the connected PRODUCTION company's realm id from connector secrets. */
function productionRealmId(secretsEnc: string | null): string | null {
  if (!secretsEnc) return null;
  let stored: Record<string, unknown>;
  try {
    stored = decryptJson<Record<string, unknown>>(secretsEnc);
  } catch {
    return null;
  }
  const env = stored["__env"] as Record<string, { realmId?: string }> | undefined;
  const fromEnv = env?.production?.realmId;
  if (typeof fromEnv === "string" && fromEnv) return fromEnv;
  // Legacy flat bag (no __env namespace).
  const flat = (stored as { realmId?: string }).realmId;
  return typeof flat === "string" && flat ? flat : null;
}

export async function purgeNonProductionQboData(): Promise<QboCleanupResult> {
  const connector = await prisma.connector.findUnique({
    where: { type: "QUICKBOOKS_ONLINE" },
    select: { secretsEnc: true },
  });
  const prodRealm = productionRealmId(connector?.secretsEnc ?? null);
  if (!prodRealm) {
    return {
      ok: false,
      message:
        "No connected production QuickBooks company found. Connect production (and Test connection) first, then retry.",
      customersDeleted: 0,
      itemsDeleted: 0,
      clientsDeleted: 0,
      clientsKept: 0,
    };
  }

  // Sandbox customers = any QBO customer not in the production realm.
  const sandboxCustomers = await prisma.qboCustomer.findMany({
    where: { realmId: { not: prodRealm } },
    select: { clientId: true },
  });
  const candidateClientIds = [
    ...new Set(sandboxCustomers.map((c) => c.clientId).filter((id): id is string => !!id)),
  ];

  // A client is removable only if it has NO other source link and NO business
  // data — otherwise it's kept (deleting it would orphan real records).
  const removableClientIds: string[] = [];
  let clientsKept = 0;
  for (const clientId of candidateClientIds) {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        tdSynnexCustomer: { select: { id: true } },
        huduMatch: { select: { id: true } },
        superOpsMatch: { select: { id: true } },
        _count: {
          select: { billingRuns: true, crmOpportunities: true, superOpsInvoices: true },
        },
      },
    });
    if (!client) continue;
    const hasOtherSource =
      client.tdSynnexCustomer || client.huduMatch || client.superOpsMatch;
    const hasBusiness =
      client._count.billingRuns > 0 ||
      client._count.crmOpportunities > 0 ||
      client._count.superOpsInvoices > 0;
    if (!hasOtherSource && !hasBusiness) removableClientIds.push(clientId);
    else clientsKept += 1;
  }

  const result = await prisma.$transaction(async (tx) => {
    const customers = await tx.qboCustomer.deleteMany({
      where: { realmId: { not: prodRealm } },
    });
    const items = await tx.qboItem.deleteMany({ where: { realmId: { not: prodRealm } } });
    let clientsDeleted = 0;
    if (removableClientIds.length) {
      // Clear sandbox-derived exceptions first (relation is SetNull; remove them
      // outright so no orphans linger), then the clients themselves.
      await tx.exception.deleteMany({ where: { clientId: { in: removableClientIds } } });
      const clients = await tx.client.deleteMany({
        where: { id: { in: removableClientIds } },
      });
      clientsDeleted = clients.count;
    }
    return { customersDeleted: customers.count, itemsDeleted: items.count, clientsDeleted };
  });

  return {
    ok: true,
    productionRealmId: prodRealm,
    customersDeleted: result.customersDeleted,
    itemsDeleted: result.itemsDeleted,
    clientsDeleted: result.clientsDeleted,
    clientsKept,
    message:
      `Removed ${result.customersDeleted} sandbox customer(s), ${result.itemsDeleted} sandbox item(s), ` +
      `and ${result.clientsDeleted} sandbox-only client(s).` +
      (clientsKept
        ? ` Kept ${clientsKept} client(s) that had billing/CRM or another data source.`
        : ""),
  };
}
