import "server-only";
import { prisma } from "@/lib/db";
import { boardNameFor } from "@/lib/silverfang/boards";
import {
  defaultAgreementFor,
  nextTicketNumber,
  recomputeTicketHours,
  resolveTimeEntryRate,
  slaDueDatesFor,
} from "@/lib/silverfang/service";
import { toWorkDate, weekStartOf } from "@/lib/silverfang/time";
import { contactEmailIndex, textWrite } from "@/lib/silverfang/pii";
import { isInternalNote } from "@/lib/silverfang/ticket-notes";
import {
  describeImport,
  extractTicketDetail,
  htmlToText,
  importAction,
  mapPriority,
  matchStatus,
  matchTechnician,
  summaryFrom,
  worklogHours,
  type ImportCounts,
  type StatusOption,
  type TicketDetail,
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
  /** Everything else SuperOps exposed, read out of the synced JSON. */
  detail: TicketDetail;
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
      // The connector builds its query by introspecting SuperOps' schema, so this
      // holds the description, requester, category and source that the fixed
      // column list does not.
      raw: true,
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
      detail: extractTicketDetail(r.raw),
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
    const closedHere = statuses.find((st) => st.id === status.statusId)?.isClosed ?? false;

    const contactId = await matchRequester(row.clientId, row.detail);

    if (action === "overwrite" && found) {
      await prisma.sfTicket.update({
        where: { id: found.id },
        data: {
          summary,
          priority,
          statusId: status.statusId,
          // Only fills blanks: overwriting from a source that could not match the
          // technician, requester or body would wipe what somebody put there.
          ...(assigneeId ? { assigneeId } : {}),
          ...(contactId ? { contactId } : {}),
          ...(row.detail.description
            ? { description: textWrite(row.detail.description) }
            : {}),
          ...(row.detail.category ? { type: row.detail.category } : {}),
          ...(row.detail.subCategory ? { subtype: row.detail.subCategory } : {}),
          source: row.detail.source,
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
          source: row.detail.source,
          summary,
          // The body SuperOps holds, as text and encrypted at rest like every
          // other ticket description.
          description: textWrite(row.detail.description),
          contactId,
          type: row.detail.category,
          subtype: row.detail.subCategory,
          assigneeId,
          agreementId: agreement?.id ?? null,
          slaId: board.slaId,
          responseDueAt: sla.responseDueAt,
          resolutionDueAt: sla.resolutionDueAt,
          openedAt,
          // A source ticket that is already finished arrives finished, with the
          // real dates — otherwise every closed ticket would import as resolved
          // "now" and wreck the resolution figures.
          resolvedAt: closedHere ? (row.detail.resolvedAt ?? row.updatedTime) : null,
          closedAt: closedHere ? (row.detail.closedAt ?? row.detail.resolvedAt ?? row.updatedTime) : null,
          firstRespondedAt: row.detail.resolvedAt,
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

export interface NoteImportResult {
  imported: number;
  alreadyImported: number;
  /** No SilverFang ticket for the note's SuperOps ticket. */
  noTicket: number;
  /** Nothing mirrored yet — the notes sync has not run, or found nothing. */
  available: number;
  message: string;
}

/**
 * Import mirrored SuperOps conversations as SilverFang ticket notes.
 *
 * Keyed on the note's SuperOps id, so a re-run adds nothing: a duplicated
 * conversation is the most immediately visible way an import can be wrong, and it
 * would be visible on every migrated ticket at once.
 *
 * Visibility is decided by `isInternalNote`, which treats *unknown* as internal.
 * A migrated internal note that leaked to a client is not recoverable; a client
 * reply marked internal is a cosmetic problem on a historical ticket. The
 * asymmetry decides the default.
 */
export async function importSuperOpsTicketNotes(): Promise<NoteImportResult> {
  const result: NoteImportResult = {
    imported: 0,
    alreadyImported: 0,
    noTicket: 0,
    available: 0,
    message: "",
  };

  const notes = await prisma.superOpsTicketNote.findMany({
    where: { ticketId: { not: null }, body: { not: null } },
    orderBy: { createdTime: "asc" },
    take: RUN_LIMIT * 5,
    select: {
      superOpsId: true,
      kind: true,
      isPrivate: true,
      author: true,
      authorEmail: true,
      body: true,
      createdTime: true,
      ticket: { select: { superOpsId: true } },
    },
  });
  result.available = notes.length;
  if (notes.length === 0) {
    return {
      ...result,
      message:
        "No SuperOps conversations are mirrored yet. Run the ticket notes sync from Connector " +
        "Data first — and if it reports no conversation query, this SuperOps tenant does not " +
        "expose one, which is different from these tickets having no history.",
    };
  }

  const sourceTicketIds = [...new Set(notes.map((n) => n.ticket!.superOpsId))];
  const tickets = await prisma.sfTicket.findMany({
    where: { sourceSystem: SUPEROPS_TICKET_SOURCE, externalId: { in: sourceTicketIds } },
    select: { id: true, externalId: true },
  });
  const ticketBySource = new Map(tickets.map((t) => [t.externalId!, t.id]));

  const existing = await prisma.sfTicketNote.findMany({
    where: {
      sourceSystem: SUPEROPS_TICKET_SOURCE,
      externalId: { in: notes.map((n) => n.superOpsId) },
    },
    select: { externalId: true },
  });
  const done = new Set(existing.map((e) => e.externalId!));

  for (const note of notes) {
    if (done.has(note.superOpsId)) {
      result.alreadyImported += 1;
      continue;
    }
    const ticketId = ticketBySource.get(note.ticket!.superOpsId);
    if (!ticketId) {
      result.noTicket += 1;
      continue;
    }

    const internalOnly = isInternalNote({
      externalId: note.superOpsId,
      kind: (note.kind as "reply" | "note" | "system" | null) ?? "note",
      isPrivate: note.isPrivate,
      author: note.author,
      authorEmail: note.authorEmail,
      body: note.body,
      createdAt: note.createdTime,
    });

    await prisma.sfTicketNote.create({
      data: {
        ticketId,
        // Bodies are HTML in SuperOps and encrypted at rest here, like every
        // other note.
        body: textWrite(htmlToText(note.body ?? "")) ?? "",
        internalOnly,
        authorEmail: note.authorEmail ?? note.author,
        // The original timestamp, so a migrated thread reads in the order it
        // happened rather than all arriving at import time.
        createdAt: note.createdTime ?? new Date(),
        sourceSystem: SUPEROPS_TICKET_SOURCE,
        externalId: note.superOpsId,
      },
    });
    result.imported += 1;
  }

  const parts = [`${result.imported} note${result.imported === 1 ? "" : "s"} imported`];
  if (result.alreadyImported > 0) parts.push(`${result.alreadyImported} already here`);
  if (result.noTicket > 0) parts.push(`${result.noTicket} with no imported ticket`);
  result.message =
    `${parts.join(", ")}. Anything SuperOps did not clearly mark as client-visible was ` +
    `imported as an internal note — that way round, because a leaked internal note cannot ` +
    `be taken back.`;
  return result;
}

/**
 * The SilverFang contact a SuperOps requester refers to.
 *
 * By address through the blind index, because the stored address is encrypted and
 * cannot be compared directly. Scoped to the ticket's own client, so a shared
 * address at two companies cannot attach the ticket to the wrong one.
 *
 * Returns null rather than creating a contact: this import is about tickets, and
 * inventing people as a side effect of it would be a surprise. The domain-match
 * backfill on the Contacts page is the deliberate way to do that.
 */
async function matchRequester(
  clientId: string,
  detail: TicketDetail,
): Promise<string | null> {
  if (detail.requesterEmail) {
    const byEmail = await prisma.sfContact.findFirst({
      where: { clientId, emailIndex: contactEmailIndex(detail.requesterEmail), active: true },
      select: { id: true },
    });
    if (byEmail) return byEmail.id;
  }

  const name = detail.requesterName?.trim();
  if (!name) return null;
  // Fall back to the display name, but only when it is unambiguous at this client.
  const parts = name.split(/\s+/);
  const first = parts[0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]! : null;
  const candidates = await prisma.sfContact.findMany({
    where: {
      clientId,
      active: true,
      firstName: { equals: first, mode: "insensitive" },
      ...(last ? { lastName: { equals: last, mode: "insensitive" } } : {}),
    },
    select: { id: true },
    take: 2,
  });
  return candidates.length === 1 ? candidates[0]!.id : null;
}

export interface WorklogImportResult {
  imported: number;
  /** Already imported — the unique source pair found them. */
  alreadyImported: number;
  /** No SilverFang ticket for the worklog's SuperOps ticket. */
  noTicket: number;
  /** The technician could not be matched to a user, so there is nobody to log it for. */
  noTechnician: number;
  /** Zero or missing minutes: not an hour of work. */
  noHours: number;
  message: string;
}

/**
 * Import SuperOps worklogs as SilverFang time entries.
 *
 * Keyed on `(sourceSystem, externalId)`, which is the one guard that matters
 * here: duplicated hours inflate utilisation, draw down a client's prepaid block
 * twice, and reach an invoice. A re-run finds the same entry instead.
 *
 * Entries arrive as DRAFT and are never auto-approved. Approving is what makes
 * time billable, and an import must not make that decision on somebody's behalf.
 */
export async function importSuperOpsWorklogs(): Promise<WorklogImportResult> {
  const result: WorklogImportResult = {
    imported: 0,
    alreadyImported: 0,
    noTicket: 0,
    noTechnician: 0,
    noHours: 0,
    message: "",
  };

  const worklogs = await prisma.superOpsWorklog.findMany({
    where: { ticketId: { not: null } },
    orderBy: { entryTime: "desc" },
    take: RUN_LIMIT,
    select: {
      superOpsId: true,
      technician: true,
      minutes: true,
      billable: true,
      notes: true,
      entryTime: true,
      ticket: { select: { superOpsId: true } },
    },
  });
  if (worklogs.length === 0) {
    return { ...result, message: "No SuperOps worklogs are stored in Wolf365 yet." };
  }

  const [users, chargeCode] = await Promise.all([
    prisma.user.findMany({
      where: { disabled: false },
      select: { id: true, name: true, email: true },
    }),
    // Whatever the install calls its standard labour code. Without one there is
    // nowhere to hang a time entry, so this is a setup problem, not a mapping one.
    prisma.sfChargeCode.findFirst({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true },
    }),
  ]);
  if (!chargeCode) {
    return {
      ...result,
      message: "No charge code exists, so time cannot be logged. Run SilverFang Setup first.",
    };
  }

  const sourceTicketIds = [...new Set(worklogs.map((w) => w.ticket!.superOpsId))];
  const tickets = await prisma.sfTicket.findMany({
    where: { sourceSystem: SUPEROPS_TICKET_SOURCE, externalId: { in: sourceTicketIds } },
    select: { id: true, externalId: true, clientId: true, agreementId: true },
  });
  const ticketBySource = new Map(tickets.map((t) => [t.externalId!, t]));

  const existing = await prisma.sfTimeEntry.findMany({
    where: {
      sourceSystem: SUPEROPS_TICKET_SOURCE,
      externalId: { in: worklogs.map((w) => w.superOpsId) },
    },
    select: { externalId: true },
  });
  const done = new Set(existing.map((e) => e.externalId!));

  for (const log of worklogs) {
    if (done.has(log.superOpsId)) {
      result.alreadyImported += 1;
      continue;
    }
    const ticket = ticketBySource.get(log.ticket!.superOpsId);
    if (!ticket) {
      result.noTicket += 1;
      continue;
    }
    const hours = worklogHours(log.minutes);
    if (hours == null) {
      result.noHours += 1;
      continue;
    }
    const userId = matchTechnician(log.technician, users);
    if (!userId) {
      // Deliberately not falling back to the importing user: time logged under
      // the wrong technician is worse than time not logged, because it silently
      // moves utilisation and cost between people.
      result.noTechnician += 1;
      continue;
    }

    const workedAt = log.entryTime ?? new Date();
    const workDate = toWorkDate(workedAt);
    const billable = log.billable ?? true;
    const resolved = await resolveTimeEntryRate({
      clientId: ticket.clientId,
      chargeCodeId: chargeCode.id,
      agreementId: ticket.agreementId,
      userId,
      workedAt,
      hours,
      billable,
    });
    const timesheet = await prisma.sfTimesheet.upsert({
      where: { userId_weekStart: { userId, weekStart: weekStartOf(workDate) } },
      create: { userId, weekStart: weekStartOf(workDate) },
      update: {},
    });

    await prisma.sfTimeEntry.create({
      data: {
        userId,
        ticketId: ticket.id,
        agreementId: ticket.agreementId,
        chargeCodeId: chargeCode.id,
        timesheetId: timesheet.id,
        workDate,
        hours,
        notes: log.notes,
        billable,
        timeBand: resolved.timeBand,
        rate: resolved.rate,
        costRate: resolved.costRate,
        amount: resolved.amount,
        sourceSystem: SUPEROPS_TICKET_SOURCE,
        externalId: log.superOpsId,
      },
    });
    await recomputeTicketHours(ticket.id);
    result.imported += 1;
  }

  const parts = [`${result.imported} time entr${result.imported === 1 ? "y" : "ies"} imported`];
  if (result.alreadyImported > 0) parts.push(`${result.alreadyImported} already here`);
  if (result.noTicket > 0) parts.push(`${result.noTicket} with no imported ticket`);
  if (result.noTechnician > 0) {
    parts.push(`${result.noTechnician} whose technician matched no Wolf365 user`);
  }
  if (result.noHours > 0) parts.push(`${result.noHours} with no hours`);
  result.message =
    `${parts.join(", ")}. Entries arrive as drafts — approving them is what makes them ` +
    `billable, and an import does not make that decision for you.`;
  return result;
}
