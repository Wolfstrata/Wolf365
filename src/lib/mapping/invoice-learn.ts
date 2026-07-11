import "server-only";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { learnSkuMappings, type InvoiceLineLite } from "@/lib/mapping/invoice-match";
import { isM365Subscription } from "@/lib/licensing/vendor";

/**
 * Learn SKU → QuickBooks-item mappings from a client's historical QBO invoices,
 * and persist the winners. Runs automatically inside the QBO sync so mappings
 * fill in on their own. The matching decision is the pure `learnSkuMappings`
 * (see `invoice-match.ts`); this file owns the IO. Existing mappings are never
 * overwritten (create-only via skipDuplicates).
 */

/** Raw QBO invoice shape (only the parts we read). */
interface QboInvoiceRaw {
  CustomerRef?: { value?: string };
  Line?: Array<{
    DetailType?: string;
    Description?: string;
    SalesItemLineDetail?: { ItemRef?: { value?: string; name?: string } };
  }>;
}

export interface InvoiceLearnResult {
  created: number;
  invoicesScanned: number;
  skusResolved: number;
}

export async function learnMappingsFromInvoices(params: {
  /** Runs a QBO query-language statement and returns the parsed response. */
  query: (statement: string) => Promise<{ ok: boolean; status: number; json: unknown }>;
  /** Only invoices on/after this many months ago are scanned. */
  monthsBack?: number;
  /** Safety cap on pages (100 invoices/page). */
  maxPages?: number;
  now?: Date;
}): Promise<InvoiceLearnResult> {
  const monthsBack = params.monthsBack ?? 24;
  const maxPages = params.maxPages ?? 50;
  const now = params.now ?? new Date();

  // SKUs that already have any mapping (any status, incl. REJECTED) are left
  // alone — never override a human decision or re-propose a rejected one.
  const existing = await prisma.productMapping.findMany({ select: { tdSynnexSku: true } });
  const mappedSkus = new Set(existing.map((m) => m.tdSynnexSku));

  // Clients with both a QBO customer and TD SYNNEX subscriptions → map of QBO
  // customer id -> that client's still-unmapped subs.
  const clients = await prisma.client.findMany({
    where: { qboCustomer: { isNot: null }, tdSynnexCustomer: { isNot: null } },
    select: {
      qboCustomer: { select: { qboId: true } },
      tdSynnexCustomer: {
        select: {
          subscriptions: {
            select: { productSku: true, productName: true, vendor: true },
          },
        },
      },
    },
  });

  const subsByCustomer = new Map<string, Map<string, string | null>>();
  for (const c of clients) {
    const qboId = c.qboCustomer?.qboId;
    if (!qboId) continue;
    for (const s of c.tdSynnexCustomer?.subscriptions ?? []) {
      if (!s.productSku || mappedSkus.has(s.productSku)) continue;
      if (!isM365Subscription(s)) continue; // never learn non-M365 (e.g. Cisco) SKUs
      let m = subsByCustomer.get(qboId);
      if (!m) {
        m = new Map();
        subsByCustomer.set(qboId, m);
      }
      if (!m.has(s.productSku)) m.set(s.productSku, s.productName);
    }
  }

  // Nothing to learn — skip the API calls entirely.
  if (subsByCustomer.size === 0) {
    return { created: 0, invoicesScanned: 0, skusResolved: 0 };
  }

  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, now.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);

  // Collect invoice lines per relevant customer.
  const linesByCustomer = new Map<string, InvoiceLineLite[]>();
  let invoicesScanned = 0;
  const pageSize = 100;
  let start = 1;
  for (let page = 0; page < maxPages; page += 1) {
    const statement = `select * from Invoice where TxnDate >= '${cutoff}' startposition ${start} maxresults ${pageSize}`;
    const res = await params.query(statement);
    if (!res.ok) break; // best-effort: don't fail the sync over invoice reads
    const invoices =
      (res.json as { QueryResponse?: { Invoice?: QboInvoiceRaw[] } })?.QueryResponse
        ?.Invoice ?? [];
    if (invoices.length === 0) break;
    for (const inv of invoices) {
      invoicesScanned += 1;
      const customerId = inv.CustomerRef?.value;
      if (!customerId || !subsByCustomer.has(customerId)) continue;
      const bucket = linesByCustomer.get(customerId) ?? [];
      for (const line of inv.Line ?? []) {
        const itemId = line.SalesItemLineDetail?.ItemRef?.value;
        if (!itemId) continue;
        bucket.push({
          itemId,
          itemName: line.SalesItemLineDetail?.ItemRef?.name ?? null,
          description: line.Description ?? null,
        });
      }
      linesByCustomer.set(customerId, bucket);
    }
    if (invoices.length < pageSize) break;
    start += pageSize;
  }

  const customers = [...subsByCustomer.entries()]
    .map(([qboId, subMap]) => ({
      subs: [...subMap.entries()].map(([sku, productName]) => ({ sku, productName })),
      lines: linesByCustomer.get(qboId) ?? [],
    }))
    .filter((c) => c.lines.length > 0);

  const learned = learnSkuMappings(customers);
  if (learned.length === 0) {
    return { created: 0, invoicesScanned, skusResolved: 0 };
  }

  // Create-only: skipDuplicates leaves any existing mapping untouched.
  const { count } = await prisma.productMapping.createMany({
    data: learned.map((m) => ({
      tdSynnexSku: m.sku,
      qboItemId: m.qboItemId,
      qboItemName: m.qboItemName,
      confidence: m.confidence,
      // Tag the source as the invoice-history learner (the pure matcher's
      // deterministic/fuzzy call still drives `status`).
      method: "INVOICE_HISTORY" as const,
      status: m.status,
      reviewedAt: m.status === "CONFIRMED" ? now : null,
    })),
    skipDuplicates: true,
  });

  if (count > 0) {
    await audit({
      action: "MAPPING_CHANGED",
      actorEmail: "qbo-sync",
      target: "skuMatch:from-invoices",
      metadata: { created: count, invoicesScanned, resolved: learned.length },
    });
  }

  return { created: count, invoicesScanned, skusResolved: learned.length };
}
