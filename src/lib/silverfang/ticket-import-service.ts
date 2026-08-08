import "server-only";
import { prisma } from "@/lib/db";
import { boardNameFor } from "@/lib/silverfang/boards";
import { defaultAgreementFor, nextTicketNumber, slaDueDatesFor } from "@/lib/silverfang/service";
import {
  describeImport,
  importAction,
  mapPriority,
  matchStatus,
  matchTechnician,
  summaryFrom,
  type ImportCounts,
  type StatusOption,
} from "@/lib/silverfang/ticket-import";

/**
 * Bringing SuperOps tickets into SilverFang.
 *
 * The connector already syncs them into `SuperOpsTicket`, which is a read-only
 * mirror of SuperOps. This is the step that turns those rows into real SilverFang
 * tickets you can work, log time against and bill.
 *
 * Idempotent by `(sourceSystem, externalId)`. Re-running finds the same ticket
 * rather than duplicating it, and what happens then is the operator's explicit
 * choice: leave it alone (the default) or overwrite it from SuperOps.
 *
 * What is deliberately NOT imported: the ticket body (SuperOps' description is not
 * mirrored, so there is nothing to copy), worklogs, and notes. This brings across
 * the ticket, not its history — and it says so rather than implying a full
 * migration.
 */

export const SUPEROPS_TICKET_SOURCE = "SUPEROPS";

/** Tickets per run. High enough for a real backlog, low enough to finish. */
const RUN_LIMIT = 1_000;

export interface TicketImportPreview {
  available: number;
  /** Source tickets with no matching SilverFang ticket yet. */
  toCreate: number;
  /** Already imported, and still open here. */
  existingOpen: number;
  /** Already imported and closed here — never overwritten. */
  existingClosed: number;
  /** Source client not linked to a Wolf365 client. */
  noClient: number;
  /** True when there is no usable board, so nothing can be created at all. */
  noBoard: boolean;
}

interface SourceTicket {
  superOpsId: string;
  displayId: string | null;
  subject: string | null;
  status: string | null;
  priority: string | null;
  technician: string | null;
  createdTime: Date | null;
  updatedTime: Date | null;
  clientId: string | null;
}

async function loadSourceTickets(): Promise<{ rows: SourceTicket[]; truncated: boolean }> {
  const rows = await prisma.superOpsTicket.findMany({
    orderBy: { updatedTime: "desc" },
    take: RUN_LIMIT,
    select: {
      superOpsId: true,
      displayId: true,
      subject: true,
      status: true,
      priority: true,
      technician: true,
      createdTime: true,
      updatedTime: true,
      superOpsClient: { select: { clientId: true } },
    },
  });
  return {
    rows: rows.map((r) => ({
      superOpsId: r.superOpsId,
      displayId: r.displayId,
      subject: r.subject,
      status: r.status,
      priority: r.priority,
      technician: r.technician,
      createdTime: r.createdTime,
      updatedTime: r.updatedTime,
      clientId: r.superOpsClient?.clientId ?? null,
    })),
    truncated: rows.length === RUN_LIMIT,
  };
}

/** Existing SilverFang tickets for these source ids, keyed by source id. */
async function loadExisting(sourceIds: string[]) {
  const rows = await prisma.sfTicket.findMany({
    where: { sourceSystem: SUPEROPS_TICKET_SOURCE, externalId: { in: sourceIds } },
    select: { id: true, externalId: true, closedAt: true },
  });
  return new Map(rows.map((r) => [r.externalId!, { id: r.id, closedAt: r.closedAt }]));
}

/**
 * What an import would do, without doing it.
 *
 * The whole point of the yes/no question is that the operator can see the size of
 * "overwrite" before answering it.
 */
export async function previewTicketImport(): Promise<TicketImportPreview> {
  const { rows } = await loadSourceTickets();
  const existing = await loadExisting(rows.map((r) => r.superOpsId));
  const board = await importBoard();

  const preview: TicketImportPreview = {
    available: rows.length,
    toCreate: 0,
    existingOpen: 0,
    existingClosed: 0,
    noClient: 0,
    noBoard: board == null,
  };

  for (const row of rows) {
    const found = existing.get(row.superOpsId);
    if (found) {
      if (found.closedAt) preview.existingClosed += 1;
      else preview.existingOpen += 1;
      continue;
    }
    if (!row.clientId) {
      preview.noClient += 1;
      continue;
    }
    preview.toCreate += 1;
  }

  return preview;
}

export interface TicketImportResult extends ImportCounts {
  message: string;
}

/**
 * Import (and optionally overwrite) SuperOps tickets.
 *
 * `overwrite` is passed in rather than inferred, because it is the one decision
 * here with consequences a re-run cannot undo.
 */
export async function importSuperOpsTickets(
  input: { overwrite: boolean },
  actor: { id: string; email: string },
): Promise<TicketImportResult> {
  const { rows, truncated } = await loadSourceTickets();
  const counts: ImportCounts = {
    available: rows.length,
    created: 0,
    overwritten: 0,
    skippedExisting: 0,
    skippedClosed: 0,
    skippedNoClient: 0,
    truncated,
  };
  if (rows.length === 0) {
    return { ...counts, message: describeImport(counts, input.overwrite) };
  }

  const [existing, board, users] = await Promise.all([
    loadExisting(rows.map((r) => r.superOpsId)),
    importBoard(),
    prisma.user.findMany({
      where: { disabled: false },
      select: { id: true, name: true, email: true },
    }),
  ]);

  if (!board) {
    return {
      ...counts,
      message:
        "No active board with statuses exists, so tickets cannot be created. Run SilverFang Setup first.",
    };
  }
  const statuses: StatusOption[] = board.statuses.map((s) => ({
    id: s.id,
    name: s.name,
    isDefault: s.isDefault,
    isClosed: s.isClosed,
  }));

  for (const row of rows) {
    const found = existing.get(row.superOpsId) ?? null;
    const action = importAction({ existing: found, overwrite: input.overwrite });

    if (action === "skip") {
      if (found?.closedAt) counts.skippedClosed += 1;
      else counts.skippedExisting += 1;
      continue;
    }
    if (!row.clientId) {
      counts.skippedNoClient += 1;
      continue;
    }

    const priority = mapPriority(row.priority);
    const status = matchStatus(row.status, statuses);
    if (!status) {
      // Cannot happen with a board that has statuses, but counted rather than
      // thrown so one odd row cannot abort a thousand good ones.
      counts.skippedExisting += 1;
      continue;
    }
    const assigneeId = matchTechnician(row.technician, users);
    const summary = summaryFrom(row.subject, row.displayId);
    const openedAt = row.createdTime ?? new Date();

    if (action === "overwrite" && found) {
      await prisma.sfTicket.update({
        where: { id: found.id },
        data: {
          summary,
          priority,
          statusId: status.statusId,
          // Only fills a blank: overwriting from a source that could not match the
          // technician would unassign whoever is actually working it.
          ...(assigneeId ? { assigneeId } : {}),
          sourceUpdatedAt: row.updatedTime,
        },
      });
      if (assigneeId) {
        await prisma.sfTicketAssignee.upsert({
          where: { ticketId_userId: { ticketId: found.id, userId: assigneeId } },
          create: {
            ticketId: found.id,
            userId: assigneeId,
            addedById: actor.id,
            addedByEmail: actor.email,
          },
          update: {},
        });
      }
      counts.overwritten += 1;
      continue;
    }

    // A managed client's imported ticket lands on their managed agreement, the
    // same as one raised on the form — otherwise every imported ticket starts
    // unrated.
    const agreement = await defaultAgreementFor(row.clientId, openedAt);
    const sla = await slaDueDatesFor(board.slaId, priority, openedAt);

    await prisma.$transaction(async (tx) => {
      const number = await nextTicketNumber(tx);
      return tx.sfTicket.create({
        data: {
          number,
          clientId: row.clientId!,
          boardId: board.id,
          statusId: status.statusId,
          priority,
          source: "PORTAL",
          summary,
          assigneeId,
          agreementId: agreement?.id ?? null,
          slaId: board.slaId,
          responseDueAt: sla.responseDueAt,
          resolutionDueAt: sla.resolutionDueAt,
          openedAt,
          sourceSystem: SUPEROPS_TICKET_SOURCE,
          externalId: row.superOpsId,
          sourceUpdatedAt: row.updatedTime,
          createdById: actor.id,
          createdByEmail: actor.email,
          slaEvents: {
            create: { kind: "STARTED", note: `Imported from SuperOps ${row.displayId ?? ""}`.trim() },
          },
          ...(assigneeId
            ? {
                assignees: {
                  create: {
                    userId: assigneeId,
                    addedById: actor.id,
                    addedByEmail: actor.email,
                  },
                },
              }
            : {}),
        },
      });
    });
    counts.created += 1;
  }

  return { ...counts, message: describeImport(counts, input.overwrite) };
}

/** The board imported tickets land on: the catch-all Service Desk, else any. */
async function importBoard() {
  const include = { statuses: { orderBy: { sortOrder: "asc" as const } } };
  const routed = await prisma.sfBoard.findFirst({
    where: {
      name: boardNameFor({ hasProject: false, agreementType: null }),
      active: true,
    },
    include,
  });
  if (routed && routed.statuses.length > 0) return routed;
  const any = await prisma.sfBoard.findFirst({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    include,
  });
  return any && any.statuses.length > 0 ? any : null;
}
