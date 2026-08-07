/**
 * The one definition of how tickets are ordered.
 *
 * Every list of tickets uses this — the queue, my tickets, a client, a project, a
 * phase, a contact. A PSA that orders its queue differently in two places teaches
 * people that the order means nothing, and then the order stops being read at all.
 *
 * The rule: **priority, then VIP, then oldest first.**
 *
 * VIP sits ABOVE the created date deliberately. Ordering by date first would leave
 * VIP with no observable effect at all — created timestamps are effectively unique,
 * so a tie for date-then-VIP to break essentially never occurs. Flagging a contact
 * as VIP has to change where their ticket appears, or the flag is decoration.
 *
 * Oldest first within a band, not newest: the oldest unanswered ticket at a given
 * priority is the one closest to breaching, and it is what should be picked up next.
 */

/** Priority order. P1 is the most urgent, so it sorts first. */
const PRIORITY_RANK: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };

/** Unknown priorities sort after every known one rather than jumbling among them. */
export function priorityRank(priority: string): number {
  return PRIORITY_RANK[priority] ?? 99;
}

/** The fields the ordering depends on. Anything else about a ticket is irrelevant. */
export interface OrderableTicket {
  priority: string;
  /** Ticket creation instant, or its ISO string. */
  createdAt: Date | string;
  /**
   * True when the requester or their company is flagged VIP. Derived once at the
   * query boundary rather than recomputed here, so both sources (contact and
   * client) are resolved in one place.
   */
  vip?: boolean;
  /** Final tiebreak, so the order is total and therefore stable. */
  number?: number;
}

function time(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Comparator for {@link OrderableTicket}. Total: two tickets never compare equal
 * unless every field matches, so `sort` is stable across renders and a list does
 * not reshuffle on refresh.
 */
export function compareTickets(a: OrderableTicket, b: OrderableTicket): number {
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
  if (byPriority !== 0) return byPriority;

  const aVip = a.vip === true;
  const bVip = b.vip === true;
  if (aVip !== bVip) return aVip ? -1 : 1;

  const byAge = time(a.createdAt) - time(b.createdAt);
  if (byAge !== 0) return byAge;

  // Same priority, same VIP status, same instant — order by number so the result
  // is deterministic instead of depending on the order rows came back in.
  return (a.number ?? 0) - (b.number ?? 0);
}

/** Sort a copy. Never mutates, so a cached query result cannot be reordered under a caller. */
export function sortTickets<T extends OrderableTicket>(tickets: T[]): T[] {
  return [...tickets].sort(compareTickets);
}

/**
 * The whole ordering collapsed into one lexicographically-sortable string.
 *
 * Needed because the sortable table sorts by a single column's value, so without
 * this the table would re-sort by ticket number and quietly discard the order the
 * server just applied — which is exactly what it used to do.
 *
 * Every component is fixed-width so string comparison and the comparator agree:
 * a two-digit rank, one digit for VIP (0 sorts before 1, so VIP first), the ISO
 * timestamp, and a zero-padded number.
 */
export function queueSortKey(ticket: OrderableTicket): string {
  const rank = String(priorityRank(ticket.priority)).padStart(2, "0");
  const vip = ticket.vip === true ? "0" : "1";
  const created = new Date(time(ticket.createdAt)).toISOString();
  const number = String(ticket.number ?? 0).padStart(10, "0");
  return `${rank}|${vip}|${created}|${number}`;
}

/**
 * Human-readable statement of the rule, for the UI.
 *
 * Shown next to lists so the order is explicable without reading this file — an
 * unexplained order looks arbitrary, and someone eventually "fixes" it.
 */
export const TICKET_ORDER_EXPLANATION =
  "Ordered by priority, then VIP requesters, then oldest first.";
