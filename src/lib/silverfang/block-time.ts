/**
 * Block-time (prepaid hours) balances and drawdown.
 *
 * Balances are always derived from the append-only draw ledger rather than a
 * mutable counter, so a block's remaining hours can be reconciled from history.
 * Blocks are consumed oldest-first (and expiring-soonest first) so prepaid hours
 * are used before they lapse. Pure and tested.
 */

export interface BlockLike {
  id: string;
  purchasedHours: number;
  purchasedAt: Date;
  expiresAt?: Date | null;
  /** Hours already drawn against this block (sum of its ledger rows). */
  hoursUsed: number;
}

export interface BlockBalance {
  id: string;
  purchasedHours: number;
  hoursUsed: number;
  hoursRemaining: number;
  expiresAt: Date | null;
  expired: boolean;
}

/** Remaining hours on one block (never negative). */
export function blockBalance(block: BlockLike, now = new Date()): BlockBalance {
  const remaining = round4(Math.max(0, block.purchasedHours - block.hoursUsed));
  const expired = block.expiresAt != null && block.expiresAt.getTime() <= now.getTime();
  return {
    id: block.id,
    purchasedHours: round4(block.purchasedHours),
    hoursUsed: round4(block.hoursUsed),
    hoursRemaining: remaining,
    expiresAt: block.expiresAt ?? null,
    expired,
  };
}

/** Total unexpired hours remaining across an agreement's blocks. */
export function availableHours(blocks: BlockLike[], now = new Date()): number {
  return round4(
    blocks
      .map((b) => blockBalance(b, now))
      .filter((b) => !b.expired)
      .reduce((acc, b) => acc + b.hoursRemaining, 0),
  );
}

export interface DrawAllocation {
  blockId: string;
  hours: number;
}

export interface DrawPlan {
  allocations: DrawAllocation[];
  /** Hours that no block could cover — bill these as overage. */
  overageHours: number;
}

/**
 * Plan how `hours` should be drawn from a set of blocks. Consumes unexpired
 * blocks in expiry order (soonest first, then oldest purchase) so hours are used
 * before they lapse. Anything left over is reported as overage rather than
 * silently pushing a block negative.
 */
export function planDraw(
  blocks: BlockLike[],
  hours: number,
  now = new Date(),
): DrawPlan {
  if (!Number.isFinite(hours) || hours <= 0) {
    return { allocations: [], overageHours: 0 };
  }
  const candidates = blocks
    .map((b) => blockBalance(b, now))
    .filter((b) => !b.expired && b.hoursRemaining > 0)
    .sort((a, b) => {
      const ax = a.expiresAt ? a.expiresAt.getTime() : Number.POSITIVE_INFINITY;
      const bx = b.expiresAt ? b.expiresAt.getTime() : Number.POSITIVE_INFINITY;
      if (ax !== bx) return ax - bx;
      // Stable tie-break by purchase order.
      const ap = blocks.find((x) => x.id === a.id)?.purchasedAt.getTime() ?? 0;
      const bp = blocks.find((x) => x.id === b.id)?.purchasedAt.getTime() ?? 0;
      return ap - bp;
    });

  const allocations: DrawAllocation[] = [];
  let remaining = round4(hours);
  for (const c of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(c.hoursRemaining, remaining);
    if (take > 0) {
      allocations.push({ blockId: c.id, hours: round4(take) });
      remaining = round4(remaining - take);
    }
  }
  return { allocations, overageHours: round4(Math.max(0, remaining)) };
}

/**
 * Hours beyond an agreement's included allowance for a period. Used for
 * managed-services overage billing (block time uses `planDraw` instead).
 */
export function overageHours(
  usedHours: number,
  includedHours: number | null | undefined,
): number {
  if (includedHours == null) return round4(Math.max(0, usedHours));
  return round4(Math.max(0, usedHours - includedHours));
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10_000) / 10_000;
}
