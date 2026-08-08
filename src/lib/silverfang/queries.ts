import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { evaluateTarget } from "@/lib/silverfang/sla";
import { loadSla } from "@/lib/silverfang/service";
import { sortTickets } from "@/lib/silverfang/ticket-order";
import type { TicketRow } from "@/app/(app)/silverfang/tickets/tickets-table";

/**
 * Server-side ticket queries. SLA state is evaluated here (in business hours)
 * rather than in the browser, so the table receives plain precomputed flags and
 * Prisma Decimals are converted to numbers at this boundary.
 */

export interface TicketFilters {
  boardId?: string;
  statusId?: string;
  assigneeId?: string;
  clientId?: string;
  contactId?: string;
  agreementId?: string;
  projectId?: string;
  priority?: string;
  /** "open" (default) | "closed" | "all" */
  view?: string;
  /** Free-text match on summary or ticket number. */
  q?: string;
}

export function buildTicketWhere(f: TicketFilters): Prisma.SfTicketWhereInput {
  const where: Prisma.SfTicketWhereInput = {
    // Archived clients are hidden everywhere else in the app; do the same here.
    client: { archived: false },
  };
  if (f.boardId) where.boardId = f.boardId;
  if (f.statusId) where.statusId = f.statusId;
  if (f.assigneeId) {
    // Any assignee, not only the primary. "My Tickets" has to mean every ticket
    // I am on — a ticket where I am the second assignee is still my work, and
    // filtering on the primary column alone would hide it.
    where.assignees = { some: { userId: f.assigneeId } };
  }
  if (f.clientId) where.clientId = f.clientId;
  if (f.contactId) where.contactId = f.contactId;
  if (f.agreementId) where.agreementId = f.agreementId;
  if (f.projectId) where.projectId = f.projectId;
  if (f.priority) {
    where.priority = f.priority as Prisma.SfTicketWhereInput["priority"];
  }
  const view = f.view ?? "open";
  if (view === "open") where.status = { isClosed: false };
  else if (view === "closed") where.status = { isClosed: true };
  if (f.q && f.q.trim()) {
    const q = f.q.trim();
    const asNumber = Number(q);
    where.OR = [
      { summary: { contains: q, mode: "insensitive" } },
      ...(Number.isInteger(asNumber) ? [{ number: asNumber }] : []),
    ];
  }
  return where;
}

/** Load tickets and map them to serializable rows with SLA state resolved. */
export async function getTicketRows(
  filters: TicketFilters,
  take = 500,
): Promise<TicketRow[]> {
  const tickets = await prisma.sfTicket.findMany({
    where: buildTicketWhere(filters),
    // Priority and age in SQL so the fetched window is the right one when `take`
    // bites; the final order — which also weighs VIP — is applied below by the
    // shared comparator. VIP cannot be ordered on here without joining through two
    // relations, and defining the order twice is how two lists start disagreeing.
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take,
    include: {
      client: {
        select: { id: true, name: true, sfClientProfile: { select: { vip: true } } },
      },
      contact: { select: { firstName: true, lastName: true, vip: true } },
      board: { select: { id: true, name: true } },
      status: { select: { id: true, name: true, isClosed: true } },
      assignee: { select: { name: true, email: true } },
      assignees: {
        // Primary first, then by when they were added, so the order a cell shows
        // is the order people joined rather than an arbitrary one.
        orderBy: { createdAt: "asc" },
        select: { userId: true, user: { select: { name: true, email: true } } },
      },
    },
  });

  // SLA definitions are shared across tickets; load each at most once.
  const slaCache = new Map<string, Awaited<ReturnType<typeof loadSla>>>();
  const now = new Date();
  const rows: TicketRow[] = [];

  for (const t of tickets) {
    let breached = false;
    let atRisk = false;
    let dueAt: Date | null = null;

    if (t.slaId && !t.status.isClosed) {
      if (!slaCache.has(t.slaId)) slaCache.set(t.slaId, await loadSla(t.slaId));
      const sla = slaCache.get(t.slaId) ?? null;
      if (sla) {
        // Before a first response the response target governs; after it, resolution.
        const kind = t.firstRespondedAt == null ? "RESPONSE" : "RESOLUTION";
        const state = evaluateTarget(sla, t.priority, kind, t.openedAt, now, {
          pausedMinutes: t.slaPausedMinutes,
        });
        breached = state.breached;
        atRisk = state.atRisk;
        dueAt = kind === "RESPONSE" ? t.responseDueAt : t.resolutionDueAt;
      }
    }

    rows.push({
      id: t.id,
      number: t.number,
      summary: t.summary,
      client: t.client.name,
      clientId: t.client.id,
      contact: t.contact
        ? [t.contact.firstName, t.contact.lastName].filter(Boolean).join(" ")
        : null,
      // Either source counts: a VIP contact, or any contact at a client flagged
      // VIP. Resolved once here so the comparator takes a plain boolean and every
      // list agrees on what "VIP" means.
      vip: t.contact?.vip === true || t.client.sfClientProfile?.vip === true,
      board: t.board.name,
      boardId: t.board.id,
      status: t.status.name,
      statusId: t.status.id,
      statusIsClosed: t.status.isClosed,
      priority: t.priority,
      assignee: t.assignee?.name ?? t.assignee?.email ?? null,
      // Ids as well as labels: inline editing needs to preselect the current
      // value, and a label cannot be matched back to an option reliably.
      assigneeId: t.assigneeId,
      // Everyone on the ticket, primary first — the primary is in `assignees`
      // too, so this is the whole set rather than "the others".
      assigneeIds: orderPrimaryFirst(t.assigneeId, t.assignees.map((a) => a.userId)),
      assigneeNames: orderPrimaryFirst(
        t.assigneeId,
        t.assignees.map((a) => a.userId),
      ).map(
        (id) =>
          nameOfAssignee(t.assignees, id) ??
          t.assignee?.name ??
          t.assignee?.email ??
          id,
      ),
      actualHours: Number(t.actualHours),
      openedAt: t.openedAt.toISOString(),
      slaBreached: breached,
      slaAtRisk: atRisk,
      slaDueAt: dueAt ? dueAt.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
    });
  }
  // Priority, then VIP, then oldest first — the one definition, applied to every
  // list rather than restated per page.
  return sortTickets(rows);
}

/** Options needed by the ticket filter bar and form selects. */
export async function getTicketFormOptions() {
  const [boards, clients, users, chargeCodes] = await Promise.all([
    prisma.sfBoard.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: { statuses: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.client.findMany({
      where: { archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { disabled: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    prisma.sfChargeCode.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  return { boards, clients, users, chargeCodes };
}

/** Primary first, everyone else in the order they were added. */
function orderPrimaryFirst(primaryId: string | null, ids: string[]): string[] {
  const rest = ids.filter((id) => id !== primaryId);
  return primaryId ? [primaryId, ...rest] : rest;
}

function nameOfAssignee(
  rows: { userId: string; user: { name: string | null; email: string } }[],
  id: string,
): string | null {
  const row = rows.find((r) => r.userId === id);
  return row ? (row.user.name ?? row.user.email) : null;
}
