import { scoreMatch } from "@/lib/matching/similarity";

/**
 * Pure matching for learning SKU → QuickBooks-item mappings from invoice
 * history. Dependency-free (no DB / no server-only) so it can be unit-tested and
 * reused; the IO orchestrator lives in `invoice-learn.ts`.
 *
 * The invoice history is the source of truth: a past invoice line records which
 * QBO item a product was billed under. We match a client's still-unmapped TD
 * SYNNEX subscriptions to that same client's invoice lines — first by the SKU
 * appearing literally in the line text (deterministic), then by product-name
 * similarity — and majority-vote across all lines to pick each SKU's item.
 */

/** A TD SYNNEX subscription that has no mapping yet. */
export interface UnmappedSub {
  sku: string;
  productName: string | null;
}

/** A QBO invoice item line, reduced to what matching needs. */
export interface InvoiceLineLite {
  /** QBO item id (ItemRef.value) — what a ProductMapping stores. */
  itemId: string;
  itemName: string | null;
  description: string | null;
}

export interface LearnedMapping {
  sku: string;
  qboItemId: string;
  qboItemName: string | null;
  confidence: number;
  method: "DETERMINISTIC" | "AI_ASSISTED";
  status: "CONFIRMED" | "PROPOSED";
  /** How many invoice lines (across the client's history) backed this choice. */
  votes: number;
}

interface Vote {
  count: number;
  bestConfidence: number;
  itemName: string | null;
  deterministic: boolean;
}

/** Case-insensitive containment of the SKU in the line text. */
function textHasSku(text: string, sku: string): boolean {
  if (sku.length < 4) return false; // too short to be a reliable signal
  return text.toLowerCase().includes(sku.toLowerCase());
}

export function learnSkuMappings(
  customers: { subs: UnmappedSub[]; lines: InvoiceLineLite[] }[],
  opts: { fuzzyThreshold?: number } = {},
): LearnedMapping[] {
  const fuzzyThreshold = opts.fuzzyThreshold ?? 0.6;
  const votes = new Map<string, Map<string, Vote>>();

  const record = (
    sku: string,
    itemId: string,
    itemName: string | null,
    confidence: number,
    deterministic: boolean,
  ) => {
    let byItem = votes.get(sku);
    if (!byItem) {
      byItem = new Map();
      votes.set(sku, byItem);
    }
    const existing = byItem.get(itemId);
    if (existing) {
      existing.count += 1;
      existing.bestConfidence = Math.max(existing.bestConfidence, confidence);
      existing.deterministic = existing.deterministic || deterministic;
      if (itemName && !existing.itemName) existing.itemName = itemName;
    } else {
      byItem.set(itemId, { count: 1, bestConfidence: confidence, itemName, deterministic });
    }
  };

  for (const { subs, lines } of customers) {
    if (subs.length === 0 || lines.length === 0) continue;
    for (const line of lines) {
      if (!line.itemId) continue;
      const text = `${line.description ?? ""}  ${line.itemName ?? ""}`.trim();
      for (const sub of subs) {
        if (textHasSku(text, sub.sku)) {
          record(sub.sku, line.itemId, line.itemName, 0.98, true);
          continue;
        }
        const name = sub.productName ?? sub.sku;
        const target = line.description ?? line.itemName ?? "";
        if (!target) continue;
        const { confidence, exact } = scoreMatch({ nameA: name, nameB: target });
        if (exact) {
          record(sub.sku, line.itemId, line.itemName, 1, true);
        } else if (confidence >= fuzzyThreshold) {
          record(sub.sku, line.itemId, line.itemName, confidence, false);
        }
      }
    }
  }

  const results: LearnedMapping[] = [];
  for (const [sku, byItem] of votes) {
    let winnerId: string | null = null;
    let winner: Vote | null = null;
    for (const [itemId, v] of byItem) {
      if (
        !winner ||
        v.count > winner.count ||
        (v.count === winner.count && v.bestConfidence > winner.bestConfidence)
      ) {
        winner = v;
        winnerId = itemId;
      }
    }
    if (!winnerId || !winner) continue;
    const autoConfirm = winner.deterministic || winner.bestConfidence >= 0.9;
    results.push({
      sku,
      qboItemId: winnerId,
      qboItemName: winner.itemName,
      confidence: Math.round(winner.bestConfidence * 100) / 100,
      method: winner.deterministic ? "DETERMINISTIC" : "AI_ASSISTED",
      status: autoConfirm ? "CONFIRMED" : "PROPOSED",
      votes: winner.count,
    });
  }
  return results;
}
