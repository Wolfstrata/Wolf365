"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SfTicketPriority, SfTicketSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import {
  assertTicketTransition,
  closesTicket,
  pausesSlaClock,
  reopensTicket,
  resumesSlaClock,
  timeEntryEditable,
  type StatusLike,
} from "@/lib/silverfang/status";
import { parseHours, roundHours, toWorkDate, weekStartOf } from "@/lib/silverfang/time";
import { contactEmailIndex, contactWrite, textWrite } from "@/lib/silverfang/pii";
import { pausedMinutesFor } from "@/lib/silverfang/sla";
import {
  ensureSilverFangDefaults,
  loadSla,
  nextTicketNumber,
  recomputeTicketHours,
  resolveTimeEntryRate,
  slaDueDatesFor,
} from "@/lib/silverfang/service";

export interface SfActionResult {
  ok: boolean;
  message: string;
}

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;
const optionalId = z.preprocess(emptyToUndefined, z.string().min(1).optional());

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

const ticketSchema = z.object({
  id: optionalId,
  clientId: z.string().min(1, "Select a client"),
  contactId: optionalId,
  boardId: z.string().min(1, "Select a board"),
  statusId: optionalId,
  priority: z.enum(SfTicketPriority),
  source: z.enum(SfTicketSource),
  summary: z.string().trim().min(1, "Summary is required").max(300),
  description: z.preprocess(emptyToUndefined, z.string().max(20_000).optional()),
  assigneeId: optionalId,
  agreementId: optionalId,
  projectId: optionalId,
  projectPhaseId: optionalId,
  type: z.preprocess(emptyToUndefined, z.string().max(80).optional()),
  subtype: z.preprocess(emptyToUndefined, z.string().max(80).optional()),
  estimatedHours: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(0).max(10_000).optional(),
  ),
});

function formValue(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
}

function parseTicketForm(formData: FormData) {
  return ticketSchema.parse({
    id: formValue(formData, "id"),
    clientId: formValue(formData, "clientId"),
    contactId: formValue(formData, "contactId"),
    boardId: formValue(formData, "boardId"),
    statusId: formValue(formData, "statusId"),
    priority: formValue(formData, "priority"),
    source: formValue(formData, "source"),
    summary: formValue(formData, "summary"),
    description: formValue(formData, "description"),
    assigneeId: formValue(formData, "assigneeId"),
    agreementId: formValue(formData, "agreementId"),
    projectId: formValue(formData, "projectId"),
    projectPhaseId: formValue(formData, "projectPhaseId"),
    type: formValue(formData, "type"),
    subtype: formValue(formData, "subtype"),
    estimatedHours: formValue(formData, "estimatedHours"),
  });
}

/**
 * Resolve the project/phase a ticket belongs to. A phase without its project is
 * refused rather than dropped, and a phase belonging to a different project (or
 * a project belonging to a different client) is refused too — a project ticket
 * filed under the wrong parent is worse than one that failed to save, because
 * its hours would land on somebody else's total.
 */
async function resolveTicketProject(input: {
  clientId: string;
  projectId?: string;
  projectPhaseId?: string;
}): Promise<
  | { ok: true; projectId: string | null; projectPhaseId: string | null }
  | { ok: false; message: string }
> {
  if (!input.projectId) {
    if (input.projectPhaseId) {
      return { ok: false, message: "Choose the project this phase belongs to." };
    }
    return { ok: true, projectId: null, projectPhaseId: null };
  }
  const project = await prisma.sfProject.findUnique({
    where: { id: input.projectId },
    select: { id: true, clientId: true },
  });
  if (!project) return { ok: false, message: "That project no longer exists." };
  if (project.clientId !== input.clientId) {
    return { ok: false, message: "That project belongs to a different client." };
  }
  if (!input.projectPhaseId) {
    return { ok: true, projectId: project.id, projectPhaseId: null };
  }
  const phase = await prisma.sfProjectPhase.findUnique({
    where: { id: input.projectPhaseId },
    select: { id: true, projectId: true },
  });
  if (!phase || phase.projectId !== project.id) {
    return { ok: false, message: "That phase does not belong to the chosen project." };
  }
  return { ok: true, projectId: project.id, projectPhaseId: phase.id };
}

/** Create or update a ticket. Records a field-level history trail on updates. */
export async function saveTicketAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("tickets:write");
  let ticketId: string;
  try {
    const input = parseTicketForm(formData);

    // The board owns the status list and the SLA, so resolve both from it.
    const board = await prisma.sfBoard.findUnique({
      where: { id: input.boardId },
      include: { statuses: { orderBy: { sortOrder: "asc" } } },
    });
    if (!board) return { ok: false, message: "That board no longer exists." };

    const link = await resolveTicketProject(input);
    if (!link.ok) return { ok: false, message: link.message };

    const chosenStatus = input.statusId
      ? board.statuses.find((s) => s.id === input.statusId)
      : (board.statuses.find((s) => s.isDefault) ?? board.statuses[0]);
    if (!chosenStatus) {
      return {
        ok: false,
        message: "That board has no statuses yet — add statuses in SilverFang Setup first.",
      };
    }

    if (input.id) {
      // --- Update ---
      const existing = await prisma.sfTicket.findUnique({
        where: { id: input.id },
        include: { status: true },
      });
      if (!existing) return { ok: false, message: "That ticket no longer exists." };

      const statusChanged = existing.statusId !== chosenStatus.id;
      if (statusChanged) {
        assertTicketTransition(existing.status as StatusLike, chosenStatus as StatusLike);
      }

      // Recompute SLA targets when the priority changes (targets are per priority).
      const slaDates =
        existing.priority !== input.priority
          ? await slaDueDatesFor(
              existing.slaId,
              input.priority,
              existing.openedAt,
              existing.slaPausedMinutes,
            )
          : null;

      // Track SLA clock pause/resume across the status change.
      let slaPausedAt = existing.slaPausedAt;
      let slaPausedMinutes = existing.slaPausedMinutes;
      if (statusChanged) {
        const from = existing.status as StatusLike;
        if (pausesSlaClock(from, chosenStatus as StatusLike)) {
          slaPausedAt = new Date();
        } else if (resumesSlaClock(from, chosenStatus as StatusLike) && existing.slaPausedAt) {
          const sla = await loadSla(existing.slaId);
          if (sla) {
            slaPausedMinutes += pausedMinutesFor(sla, existing.slaPausedAt, new Date());
          }
          slaPausedAt = null;
        }
      }

      const closing = statusChanged && closesTicket(existing.status as StatusLike, chosenStatus as StatusLike);
      const reopening =
        statusChanged && reopensTicket(existing.status as StatusLike, chosenStatus as StatusLike);

      // Diff for the history trail — only fields that actually changed.
      const changes: { field: string; oldValue: string | null; newValue: string | null }[] = [];
      const track = (field: string, oldV: unknown, newV: unknown) => {
        const a = oldV == null ? null : String(oldV);
        const b = newV == null ? null : String(newV);
        if (a !== b) changes.push({ field, oldValue: a, newValue: b });
      };
      track("summary", existing.summary, input.summary);
      track("priority", existing.priority, input.priority);
      track("status", existing.status.name, chosenStatus.name);
      track("assigneeId", existing.assigneeId, input.assigneeId ?? null);
      track("boardId", existing.boardId, input.boardId);
      track("agreementId", existing.agreementId, input.agreementId ?? null);
      track("contactId", existing.contactId, input.contactId ?? null);
      track("projectId", existing.projectId, link.projectId);
      track("projectPhaseId", existing.projectPhaseId, link.projectPhaseId);

      await prisma.$transaction([
        prisma.sfTicket.update({
          where: { id: input.id },
          data: {
            clientId: input.clientId,
            contactId: input.contactId ?? null,
            boardId: input.boardId,
            statusId: chosenStatus.id,
            priority: input.priority,
            source: input.source,
            summary: input.summary,
            description: textWrite(input.description),
            assigneeId: input.assigneeId ?? null,
            agreementId: input.agreementId ?? null,
            projectId: link.projectId,
            projectPhaseId: link.projectPhaseId,
            type: input.type ?? null,
            subtype: input.subtype ?? null,
            estimatedHours: input.estimatedHours ?? null,
            ...(slaDates ?? {}),
            slaPausedAt,
            slaPausedMinutes,
            ...(closing
              ? { closedAt: new Date(), resolvedAt: existing.resolvedAt ?? new Date() }
              : {}),
            ...(reopening ? { closedAt: null } : {}),
          },
        }),
        ...(changes.length > 0
          ? [
              prisma.sfTicketHistory.createMany({
                data: changes.map((c) => ({
                  ticketId: input.id!,
                  field: c.field,
                  oldValue: c.oldValue,
                  newValue: c.newValue,
                  changedById: user.id,
                  changedByEmail: user.email,
                })),
              }),
            ]
          : []),
        ...(statusChanged && (closing || reopening)
          ? [
              prisma.sfSlaEvent.create({
                data: {
                  ticketId: input.id,
                  kind: closing ? "RESOLVED" : "REOPENED",
                  note: `Status → ${chosenStatus.name}`,
                },
              }),
            ]
          : []),
      ]);

      await audit({
        action: closing ? "TICKET_CLOSED" : "TICKET_UPDATED",
        actorId: user.id,
        actorEmail: user.email,
        target: `sfTicket:${input.id}`,
        metadata: { fields: changes.map((c) => c.field) },
      });
      revalidatePath("/silverfang/tickets");
      revalidatePath(`/silverfang/tickets/${input.id}`);
      return { ok: true, message: "Ticket updated." };
    }

    // --- Create ---
    const openedAt = new Date();
    const slaDates = await slaDueDatesFor(board.slaId, input.priority, openedAt);
    const created = await prisma.$transaction(async (tx) => {
      const number = await nextTicketNumber(tx);
      return tx.sfTicket.create({
        data: {
          number,
          clientId: input.clientId,
          contactId: input.contactId ?? null,
          boardId: input.boardId,
          statusId: chosenStatus.id,
          priority: input.priority,
          source: input.source,
          summary: input.summary,
          description: textWrite(input.description),
          assigneeId: input.assigneeId ?? null,
          agreementId: input.agreementId ?? null,
          projectId: link.projectId,
          projectPhaseId: link.projectPhaseId,
          type: input.type ?? null,
          subtype: input.subtype ?? null,
          estimatedHours: input.estimatedHours ?? null,
          slaId: board.slaId,
          responseDueAt: slaDates.responseDueAt,
          resolutionDueAt: slaDates.resolutionDueAt,
          openedAt,
          createdById: user.id,
          createdByEmail: user.email,
          slaEvents: { create: { kind: "STARTED", note: "Ticket opened" } },
        },
      });
    });
    ticketId = created.id;

    await audit({
      action: "TICKET_CREATED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfTicket:${created.id}`,
      metadata: { number: created.number, clientId: input.clientId, priority: input.priority },
    });
    revalidatePath("/silverfang/tickets");
    if (link.projectId) revalidatePath(`/silverfang/projects/${link.projectId}`);
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
  // Outside the try so Next's redirect control-flow isn't caught as an error.
  redirect(`/silverfang/tickets/${ticketId}`);
}

/** Move a ticket to another status (queue-style quick action). */
export async function setTicketStatusAction(formData: FormData): Promise<void> {
  const user = await requirePermission("tickets:write");
  const ticketId = z.string().min(1).parse(formData.get("ticketId"));
  const statusId = z.string().min(1).parse(formData.get("statusId"));

  const [ticket, status] = await Promise.all([
    prisma.sfTicket.findUnique({ where: { id: ticketId }, include: { status: true } }),
    prisma.sfStatus.findUnique({ where: { id: statusId } }),
  ]);
  if (!ticket || !status || status.boardId !== ticket.boardId) return;
  if (ticket.statusId === status.id) return;
  assertTicketTransition(ticket.status as StatusLike, status as StatusLike);

  // Closing a ticket requires the dedicated permission.
  const closing = closesTicket(ticket.status as StatusLike, status as StatusLike);
  if (closing) await requirePermission("tickets:close");

  let slaPausedAt = ticket.slaPausedAt;
  let slaPausedMinutes = ticket.slaPausedMinutes;
  if (pausesSlaClock(ticket.status as StatusLike, status as StatusLike)) {
    slaPausedAt = new Date();
  } else if (resumesSlaClock(ticket.status as StatusLike, status as StatusLike) && ticket.slaPausedAt) {
    const sla = await loadSla(ticket.slaId);
    if (sla) slaPausedMinutes += pausedMinutesFor(sla, ticket.slaPausedAt, new Date());
    slaPausedAt = null;
  }
  const reopening = reopensTicket(ticket.status as StatusLike, status as StatusLike);

  await prisma.$transaction([
    prisma.sfTicket.update({
      where: { id: ticketId },
      data: {
        statusId: status.id,
        slaPausedAt,
        slaPausedMinutes,
        ...(closing
          ? { closedAt: new Date(), resolvedAt: ticket.resolvedAt ?? new Date() }
          : {}),
        ...(reopening ? { closedAt: null } : {}),
      },
    }),
    prisma.sfTicketHistory.create({
      data: {
        ticketId,
        field: "status",
        oldValue: ticket.status.name,
        newValue: status.name,
        changedById: user.id,
        changedByEmail: user.email,
      },
    }),
  ]);

  await audit({
    action: closing ? "TICKET_CLOSED" : "TICKET_UPDATED",
    actorId: user.id,
    actorEmail: user.email,
    target: `sfTicket:${ticketId}`,
    metadata: { status: status.name },
  });
  revalidatePath(`/silverfang/tickets/${ticketId}`);
  revalidatePath("/silverfang/tickets");
}

/** Assign (or unassign) a ticket. */
export async function assignTicketAction(formData: FormData): Promise<void> {
  const user = await requirePermission("tickets:assign");
  const ticketId = z.string().min(1).parse(formData.get("ticketId"));
  const raw = formData.get("assigneeId");
  const assigneeId = typeof raw === "string" && raw.trim() !== "" ? raw : null;

  const ticket = await prisma.sfTicket.findUnique({ where: { id: ticketId } });
  if (!ticket || ticket.assigneeId === assigneeId) return;

  await prisma.$transaction([
    prisma.sfTicket.update({ where: { id: ticketId }, data: { assigneeId } }),
    prisma.sfTicketHistory.create({
      data: {
        ticketId,
        field: "assigneeId",
        oldValue: ticket.assigneeId,
        newValue: assigneeId,
        changedById: user.id,
        changedByEmail: user.email,
      },
    }),
  ]);
  await audit({
    action: "TICKET_ASSIGNED",
    actorId: user.id,
    actorEmail: user.email,
    target: `sfTicket:${ticketId}`,
    metadata: { assigneeId },
  });
  revalidatePath(`/silverfang/tickets/${ticketId}`);
  revalidatePath("/silverfang/tickets");
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const noteSchema = z.object({
  ticketId: z.string().min(1),
  body: z.string().trim().min(1, "Note cannot be empty").max(20_000),
  internalOnly: z.coerce.boolean(),
});

/**
 * Add a note. Internal notes are never exposed to a client — the flag is stored
 * and every client-facing read must filter on it.
 */
export async function addTicketNoteAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("tickets:write");
  try {
    const input = noteSchema.parse({
      ticketId: formValue(formData, "ticketId"),
      body: formValue(formData, "body"),
      internalOnly: formData.get("internalOnly") === "on",
    });

    const ticket = await prisma.sfTicket.findUnique({ where: { id: input.ticketId } });
    if (!ticket) return { ok: false, message: "That ticket no longer exists." };

    // The first client-visible note counts as the SLA first response.
    const isFirstResponse = !input.internalOnly && ticket.firstRespondedAt == null;

    await prisma.$transaction([
      prisma.sfTicketNote.create({
        data: {
          ticketId: input.ticketId,
          body: textWrite(input.body) ?? "",
          internalOnly: input.internalOnly,
          authorId: user.id,
          authorEmail: user.email,
        },
      }),
      ...(isFirstResponse
        ? [
            prisma.sfTicket.update({
              where: { id: input.ticketId },
              data: { firstRespondedAt: new Date() },
            }),
            prisma.sfSlaEvent.create({
              data: {
                ticketId: input.ticketId,
                kind: "RESPONDED",
                targetKind: "RESPONSE",
                note: "First client-visible note",
              },
            }),
          ]
        : []),
    ]);

    await audit({
      action: "TICKET_NOTE_ADDED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfTicket:${input.ticketId}`,
      metadata: { internalOnly: input.internalOnly, firstResponse: isFirstResponse },
    });
    revalidatePath(`/silverfang/tickets/${input.ticketId}`);
    return {
      ok: true,
      message: input.internalOnly ? "Internal note added." : "Note added.",
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Time entries
// ---------------------------------------------------------------------------

const timeSchema = z.object({
  id: optionalId,
  ticketId: z.string().min(1),
  chargeCodeId: z.string().min(1, "Select a charge code"),
  // Optional: logging time now is the common case, so an omitted date means
  // today rather than a validation error. Speed matters more here than ceremony —
  // an entry nobody bothers to make is worse than one dated by default.
  workDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  hours: z.string().min(1, "Enter time worked"),
  notes: z.preprocess(emptyToUndefined, z.string().max(20_000).optional()),
  internalOnly: z.coerce.boolean(),
  billable: z.coerce.boolean(),
});

/** Log (or edit) time against a ticket, resolving the rate at save time. */
export async function saveTimeEntryAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("time:log");
  try {
    const input = timeSchema.parse({
      id: formValue(formData, "id"),
      ticketId: formValue(formData, "ticketId"),
      chargeCodeId: formValue(formData, "chargeCodeId"),
      workDate: formValue(formData, "workDate"),
      hours: formValue(formData, "hours"),
      notes: formValue(formData, "notes"),
      internalOnly: formData.get("internalOnly") === "on",
      billable: formData.get("billable") === "on",
    });

    const parsed = parseHours(input.hours);
    if (parsed == null) {
      return { ok: false, message: "Enter time as 1.5, 1:30, 90m or 1h30m." };
    }
    const hours = roundHours(parsed);

    const ticket = await prisma.sfTicket.findUnique({ where: { id: input.ticketId } });
    if (!ticket) return { ok: false, message: "That ticket no longer exists." };

    // No date given means "now": the work date is today and the entry keeps the
    // actual timestamp, so the time band (after-hours, weekend) is still resolved
    // from when the work really happened.
    const workedAt = input.workDate ?? new Date();
    const workDate = toWorkDate(workedAt);
    const resolved = await resolveTimeEntryRate({
      clientId: ticket.clientId,
      chargeCodeId: input.chargeCodeId,
      agreementId: ticket.agreementId,
      userId: user.id,
      workedAt,
      hours,
      billable: input.billable,
    });

    if (input.id) {
      const existing = await prisma.sfTimeEntry.findUnique({ where: { id: input.id } });
      if (!existing) return { ok: false, message: "That time entry no longer exists." };
      if (existing.userId !== user.id) {
        // Editing someone else's time is an approval-level action.
        await requirePermission("time:approve");
      }
      if (!timeEntryEditable(existing.status)) {
        return {
          ok: false,
          message: `This entry is ${existing.status.toLowerCase()} and can no longer be edited.`,
        };
      }
      await prisma.sfTimeEntry.update({
        where: { id: input.id },
        data: {
          chargeCodeId: input.chargeCodeId,
          workDate,
          hours,
          notes: input.notes ?? null,
          internalOnly: input.internalOnly,
          billable: input.billable,
          timeBand: resolved.timeBand,
          rate: resolved.rate,
          costRate: resolved.costRate,
          amount: resolved.amount,
        },
      });
      await recomputeTicketHours(input.ticketId);
      await audit({
        action: "TIME_ENTRY_UPDATED",
        actorId: user.id,
        actorEmail: user.email,
        target: `sfTimeEntry:${input.id}`,
        metadata: { ticketId: input.ticketId, hours },
      });
      revalidatePath(`/silverfang/tickets/${input.ticketId}`);
      return { ok: true, message: "Time entry updated." };
    }

    // Attach to the user's open weekly timesheet, creating it on demand.
    const weekStart = weekStartOf(workDate);
    const timesheet = await prisma.sfTimesheet.upsert({
      where: { userId_weekStart: { userId: user.id, weekStart } },
      create: { userId: user.id, weekStart },
      update: {},
    });

    const entry = await prisma.sfTimeEntry.create({
      data: {
        userId: user.id,
        ticketId: input.ticketId,
        agreementId: ticket.agreementId,
        chargeCodeId: input.chargeCodeId,
        timesheetId: timesheet.id,
        workDate,
        hours,
        notes: input.notes ?? null,
        internalOnly: input.internalOnly,
        billable: input.billable,
        timeBand: resolved.timeBand,
        rate: resolved.rate,
        costRate: resolved.costRate,
        amount: resolved.amount,
      },
    });
    await recomputeTicketHours(input.ticketId);

    await audit({
      action: "TIME_LOGGED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfTimeEntry:${entry.id}`,
      metadata: { ticketId: input.ticketId, hours, billable: input.billable },
    });
    revalidatePath(`/silverfang/tickets/${input.ticketId}`);
    revalidatePath("/silverfang/time");
    return {
      ok: true,
      message:
        resolved.rate == null && input.billable
          ? "Time logged, but no rate could be resolved — set a rate rule in SilverFang Setup."
          : "Time logged.",
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Delete a time entry that hasn't been approved/invoiced. */
export async function deleteTimeEntryAction(formData: FormData): Promise<void> {
  const user = await requirePermission("time:log");
  const id = z.string().min(1).parse(formData.get("id"));
  const entry = await prisma.sfTimeEntry.findUnique({ where: { id } });
  if (!entry) return;
  if (entry.userId !== user.id) await requirePermission("time:approve");
  if (!timeEntryEditable(entry.status)) return;

  await prisma.sfTimeEntry.delete({ where: { id } });
  if (entry.ticketId) await recomputeTicketHours(entry.ticketId);
  await audit({
    action: "TIME_ENTRY_UPDATED",
    actorId: user.id,
    actorEmail: user.email,
    target: `sfTimeEntry:${id}`,
    metadata: { deleted: true },
  });
  if (entry.ticketId) revalidatePath(`/silverfang/tickets/${entry.ticketId}`);
  revalidatePath("/silverfang/time");
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/**
 * Import SuperOps clients + contacts into SilverFang. Re-runnable: contacts key
 * off (sourceSystem, externalId) so a second run updates instead of duplicating.
 */
export async function importSuperOpsClientsAction(
  _prev: SfActionResult | null,
  _formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const { importSuperOpsClients, describeImport } = await import(
      "@/lib/silverfang/import"
    );
    const result = await importSuperOpsClients({ id: user.id, email: user.email });
    await audit({
      action: "SILVERFANG_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: "silverfang:clients-import",
      metadata: { ...result },
    });
    revalidatePath("/silverfang/clients");
    revalidatePath("/silverfang/contacts");
    revalidatePath("/silverfang/setup");
    return { ok: true, message: describeImport(result) };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

const clientProfileSchema = z.object({
  clientId: z.string().min(1),
  accountManager: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
  defaultBoardId: optionalId,
  defaultAgreementId: optionalId,
  allowClientEmail: z.coerce.boolean(),
  vip: z.coerce.boolean(),
  notes: z.preprocess(emptyToUndefined, z.string().max(20_000).optional()),
});

/** Save a client's SilverFang profile (account manager, defaults, VIP, notes). */
export async function saveClientProfileAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const input = clientProfileSchema.parse({
      clientId: formValue(formData, "clientId"),
      accountManager: formValue(formData, "accountManager"),
      defaultBoardId: formValue(formData, "defaultBoardId"),
      defaultAgreementId: formValue(formData, "defaultAgreementId"),
      allowClientEmail: formData.get("allowClientEmail") === "on",
      vip: formData.get("vip") === "on",
      notes: formValue(formData, "notes"),
    });

    const client = await prisma.client.findUnique({ where: { id: input.clientId } });
    if (!client) return { ok: false, message: "That client no longer exists." };

    const data = {
      accountManager: input.accountManager ?? null,
      defaultBoardId: input.defaultBoardId ?? null,
      defaultAgreementId: input.defaultAgreementId ?? null,
      allowClientEmail: input.allowClientEmail,
      vip: input.vip,
      notes: input.notes ?? null,
    };
    const beforeProfile = await prisma.sfClientProfile.findUnique({
      where: { clientId: input.clientId },
    });
    const savedProfile = await prisma.sfClientProfile.upsert({
      where: { clientId: input.clientId },
      create: { clientId: input.clientId, ...data },
      update: data,
    });
    const { recordChanges } = await import("@/lib/silverfang/change-log");
    await recordChanges({
      entity: "SfClientProfile",
      entityId: input.clientId,
      entityLabel: client.name,
      actor: { id: user.id, email: user.email },
      before: beforeProfile,
      after: savedProfile as unknown as Record<string, unknown>,
      fields: [
        "accountManager",
        "defaultBoardId",
        "defaultAgreementId",
        "allowClientEmail",
        "vip",
        "notes",
        "active",
      ],
    });

    await audit({
      action: "SF_CLIENT_PROFILE_UPDATED",
      actorId: user.id,
      actorEmail: user.email,
      target: `silverfang:clientProfile:${input.clientId}`,
      // Audited explicitly: turning client email on is the setting that decides
      // whether a real customer can receive mail from us.
      metadata: {
        allowClientEmail: input.allowClientEmail,
        vip: input.vip,
        hasAccountManager: Boolean(input.accountManager),
      },
    });
    revalidatePath(`/silverfang/clients/${input.clientId}`);
    revalidatePath("/silverfang/clients");
    return {
      ok: true,
      message: input.allowClientEmail
        ? "Client profile saved. Email to this client is now ALLOWED."
        : "Client profile saved. Email to this client stays off — nothing will be sent to them.",
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const contactSchema = z.object({
  id: optionalId,
  clientId: z.string().min(1, "Select a client"),
  firstName: z.string().trim().min(1, "First name is required").max(120),
  lastName: z.preprocess(emptyToUndefined, z.string().max(120).optional()),
  email: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[^\s@]+@[^\s@.]+\.[^\s@]+$/, "Enter a valid email address")
      .optional(),
  ),
  phone: z.preprocess(emptyToUndefined, z.string().max(60).optional()),
  mobile: z.preprocess(emptyToUndefined, z.string().max(60).optional()),
  title: z.preprocess(emptyToUndefined, z.string().max(160).optional()),
  isPrimary: z.coerce.boolean(),
  active: z.coerce.boolean(),
  notes: z.preprocess(emptyToUndefined, z.string().max(20_000).optional()),
});

/**
 * Create or update a contact. Editing stamps `locallyModifiedAt`, which makes the
 * SuperOps import leave the row alone from then on — SilverFang owns it.
 */
export async function saveContactAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("tickets:write");
  try {
    const input = contactSchema.parse({
      id: formValue(formData, "id"),
      clientId: formValue(formData, "clientId"),
      firstName: formValue(formData, "firstName"),
      lastName: formValue(formData, "lastName"),
      email: formValue(formData, "email"),
      phone: formValue(formData, "phone"),
      mobile: formValue(formData, "mobile"),
      title: formValue(formData, "title"),
      isPrimary: formData.get("isPrimary") === "on",
      active: formData.get("active") === "on",
      notes: formValue(formData, "notes"),
    });

    const client = await prisma.client.findUnique({
      where: { id: input.clientId },
      select: { id: true, name: true },
    });
    if (!client) return { ok: false, message: "That client no longer exists." };

    // An email address can only belong to one contact: inbound mail is routed by
    // sender, so a duplicate would silently file tickets against whichever record
    // happened to sort first.
    if (input.email) {
      // The address is encrypted, so equality on the column can never match.
      // The blind index is what makes this uniqueness check possible at all.
      const clash = await prisma.sfContact.findFirst({
        where: {
          emailIndex: contactEmailIndex(input.email),
          ...(input.id ? { id: { not: input.id } } : {}),
        },
        select: { firstName: true, lastName: true, client: { select: { name: true } } },
      });
      if (clash) {
        return {
          ok: false,
          message: `${input.email} is already on ${clash.firstName} ${
            clash.lastName ?? ""
          }`.trim() + ` at ${clash.client.name}. Inbound email routes by sender, so one address can only belong to one contact.`,
        };
      }
    }

    const data = {
      clientId: input.clientId,
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      // Encrypted, with the blind index and domain derived in the same step.
      ...contactWrite({ email: input.email, phone: input.phone, mobile: input.mobile }),
      title: input.title ?? null,
      isPrimary: input.isPrimary,
      active: input.active,
      notes: input.notes ?? null,
      locallyModifiedAt: new Date(),
    };

    const before = input.id
      ? await prisma.sfContact.findUnique({ where: { id: input.id } })
      : null;
    const saved = input.id
      ? await prisma.sfContact.update({ where: { id: input.id }, data })
      : await prisma.sfContact.create({ data });

    const { recordChanges } = await import("@/lib/silverfang/change-log");
    const { describeChanges } = await import("@/lib/silverfang/changes");
    const changes = await recordChanges({
      entity: "SfContact",
      entityId: saved.id,
      entityLabel: [saved.firstName, saved.lastName].filter(Boolean).join(" "),
      actor: { id: user.id, email: user.email },
      before,
      after: saved as unknown as Record<string, unknown>,
      // Contact detail is deliberately absent: the trail stores old and new
      // values as text, so recording email/phone here would copy the personal
      // data straight back out of the encrypted column into a plaintext one.
      fields: [
        "clientId",
        "firstName",
        "lastName",
        "title",
        "isPrimary",
        "active",
        "notes",
      ],
    });

    // One primary per client.
    if (input.isPrimary) {
      await prisma.sfContact.updateMany({
        where: { clientId: input.clientId, id: { not: saved.id }, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    await audit({
      action: input.id ? "SF_CONTACT_UPDATED" : "SF_CONTACT_CREATED",
      actorId: user.id,
      actorEmail: user.email,
      target: `silverfang:contact:${saved.id}`,
      metadata: {
        clientId: input.clientId,
        hasEmail: Boolean(input.email),
        isPrimary: input.isPrimary,
        active: input.active,
        changed: changes.map((c) => c.field),
      },
    });
    revalidatePath("/silverfang/contacts");
    revalidatePath(`/silverfang/clients/${input.clientId}`);
    revalidatePath("/silverfang/clients");
    return {
      ok: true,
      message: input.id
        ? changes.length === 0
          ? "No changes to save."
          : `Saved ${describeChanges(changes)}. Future SuperOps imports will leave this contact alone.`
        : "Contact created.",
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/**
 * Delete a contact. Refused once it has tickets — the ticket history would lose
 * its requester. Deactivating is the right move there, and the message says so.
 */
export async function deleteContactAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const id = z.string().min(1).parse(formValue(formData, "id"));
    const contact = await prisma.sfContact.findUnique({
      where: { id },
      select: { id: true, clientId: true, _count: { select: { tickets: true } } },
    });
    if (!contact) return { ok: false, message: "That contact no longer exists." };
    if (contact._count.tickets > 0) {
      return {
        ok: false,
        message: `This contact is the requester on ${contact._count.tickets} ticket(s), so deleting it would strip them of their requester. Untick “Active” instead — it hides the contact from pickers and keeps the history intact.`,
      };
    }

    const doomed = await prisma.sfContact.findUnique({ where: { id } });
    await prisma.sfContact.delete({ where: { id } });
    const { recordChanges } = await import("@/lib/silverfang/change-log");
    await recordChanges({
      entity: "SfContact",
      entityId: id,
      entityLabel: doomed
        ? [doomed.firstName, doomed.lastName].filter(Boolean).join(" ")
        : null,
      actor: { id: user.id, email: user.email },
      before: doomed as unknown as Record<string, unknown>,
      after: null,
      fields: [],
    });
    await audit({
      action: "SF_CONTACT_DELETED",
      actorId: user.id,
      actorEmail: user.email,
      target: `silverfang:contact:${id}`,
      metadata: { clientId: contact.clientId, email: doomed?.email ?? null },
    });
    revalidatePath("/silverfang/contacts");
    revalidatePath(`/silverfang/clients/${contact.clientId}`);
    return { ok: true, message: "Contact deleted." };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/**
 * Master switch for all outbound SilverFang email.
 *
 * Enabling requires typing ENABLE. Disabling is one click — friction belongs only
 * on the path that lets mail reach real customers, never on the path that stops
 * it. Both directions are audited.
 */
export async function setEmailMasterSwitchAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const { ENABLE_CONFIRMATION } = await import("@/lib/silverfang/email-policy");
    const { POLICY_ID } = await import("@/lib/silverfang/mail");
    const enable = formValue(formData, "enable") === "true";
    const confirmation = (formValue(formData, "confirm") ?? "").trim();

    if (enable && confirmation !== ENABLE_CONFIRMATION) {
      return {
        ok: false,
        message: `Type ${ENABLE_CONFIRMATION} to turn outbound email on. Nothing has changed.`,
      };
    }

    const beforePolicy = await prisma.sfEmailPolicy.findUnique({ where: { id: POLICY_ID } });
    await prisma.sfEmailPolicy.upsert({
      where: { id: POLICY_ID },
      create: { id: POLICY_ID, outboundEnabled: enable, updatedByEmail: user.email },
      update: { outboundEnabled: enable, updatedByEmail: user.email },
    });
    const { recordChanges } = await import("@/lib/silverfang/change-log");
    await recordChanges({
      entity: "SfEmailPolicy",
      entityId: POLICY_ID,
      entityLabel: "Outbound email master switch",
      actor: { id: user.id, email: user.email },
      // Treat a first-ever write as an update from the effective default (off),
      // so enabling it is always recorded as a change rather than a creation.
      before: beforePolicy ?? { outboundEnabled: false },
      after: { outboundEnabled: enable },
      fields: ["outboundEnabled"],
    });

    await audit({
      action: "SF_EMAIL_POLICY_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: "silverfang:email-master-switch",
      metadata: { outboundEnabled: enable },
    });
    revalidatePath("/silverfang/email");
    revalidatePath("/silverfang/clients");
    return {
      ok: true,
      message: enable
        ? "Outbound email is ON. Clients with “Allow email to client” enabled can now be emailed."
        : "Outbound email is OFF. Nothing will be sent to anyone, client or technician.",
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

const replySchema = z.object({
  ticketId: z.string().min(1),
  to: z.string().trim().min(1, "Add at least one recipient"),
  cc: z.preprocess(emptyToUndefined, z.string().max(2_000).optional()),
  subject: z.preprocess(emptyToUndefined, z.string().max(300).optional()),
  body: z.string().trim().min(1, "The message body is empty").max(50_000),
});

/**
 * Email a ticket reply to the client. The mail is sent before anything is
 * recorded, so the timeline never shows a reply the provider refused.
 */
export async function sendTicketEmailAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("tickets:write");
  try {
    const input = replySchema.parse({
      ticketId: formValue(formData, "ticketId"),
      to: formValue(formData, "to"),
      cc: formValue(formData, "cc"),
      subject: formValue(formData, "subject"),
      body: formValue(formData, "body"),
    });

    const { sendTicketReply } = await import("@/lib/silverfang/email-send");
    const result = await sendTicketReply({
      ticketId: input.ticketId,
      to: input.to.split(/[,;]/),
      cc: input.cc ? input.cc.split(/[,;]/) : [],
      subject: input.subject ?? null,
      body: textWrite(input.body) ?? "",
      actor: { id: user.id, email: user.email },
    });
    if (!result.ok) return result;

    await audit({
      action: "TICKET_EMAIL_SENT",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfTicket:${input.ticketId}`,
      metadata: { firstResponse: result.firstResponse ?? false },
    });
    revalidatePath(`/silverfang/tickets/${input.ticketId}`);
    return { ok: true, message: result.message };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

const mailboxSchema = z.object({
  id: optionalId,
  address: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^\s@]+@[^\s@.]+\.[^\s@]+$/, "Enter a valid mailbox address"),
  name: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
  sendAsAddress: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[^\s@]+@[^\s@.]+\.[^\s@]+$/, "Enter a valid reply-as address")
      .optional(),
  ),
  // A free-text datetime here would be read as the *server's* timezone while the
  // browser sends the admin's local time, so the cutoff would silently land hours
  // off. The real requirement is "start from now", which needs no parsing.
  resetIgnoreBefore: z.coerce.boolean(),
  boardId: optionalId,
  fallbackClientId: optionalId,
  defaultPriority: z.enum(SfTicketPriority),
  provider: z.enum(["GRAPH", "RESEND"]),
  inbound: z.coerce.boolean(),
  outbound: z.coerce.boolean(),
  active: z.coerce.boolean(),
  signature: z.preprocess(emptyToUndefined, z.string().max(4_000).optional()),
});

/** Create or update a support mailbox. */
export async function saveMailboxAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const input = mailboxSchema.parse({
      id: formValue(formData, "id"),
      address: formValue(formData, "address"),
      name: formValue(formData, "name"),
      sendAsAddress: formValue(formData, "sendAsAddress"),
      resetIgnoreBefore: formData.get("resetIgnoreBefore") === "on",
      boardId: formValue(formData, "boardId"),
      fallbackClientId: formValue(formData, "fallbackClientId"),
      defaultPriority: formValue(formData, "defaultPriority"),
      provider: formValue(formData, "provider"),
      inbound: formData.get("inbound") === "on",
      outbound: formData.get("outbound") === "on",
      active: formData.get("active") === "on",
      signature: formValue(formData, "signature"),
    });

    // Receiving and polling are different things: only Graph can be *polled*, but
    // any mailbox can receive through the inbound webhook, so the provider must not
    // decide whether inbound is allowed at all.
    const inbound = input.inbound;
    // A reply-as address equal to the polled address is redundant, not an error.
    const sendAsAddress =
      input.sendAsAddress && input.sendAsAddress !== input.address ? input.sendAsAddress : null;
    const data = {
      address: input.address,
      name: input.name ?? null,
      sendAsAddress,
      // A new mailbox starts from now, so adding an established mailbox never
      // works through its history. On an existing one the cutoff only moves when
      // the admin explicitly asks.
      ignoreBefore:
        input.resetIgnoreBefore || !input.id ? new Date() : undefined,
      boardId: input.boardId ?? null,
      fallbackClientId: input.fallbackClientId ?? null,
      defaultPriority: input.defaultPriority,
      provider: input.provider,
      inbound,
      outbound: input.outbound,
      active: input.active,
      signature: input.signature ?? null,
    };

    const beforeMailbox = input.id
      ? await prisma.sfMailbox.findUnique({ where: { id: input.id } })
      : null;
    const saved = input.id
      ? await prisma.sfMailbox.update({ where: { id: input.id }, data })
      : await prisma.sfMailbox.create({ data });
    const { recordChanges: recordMailboxChanges } = await import(
      "@/lib/silverfang/change-log"
    );
    await recordMailboxChanges({
      entity: "SfMailbox",
      entityId: saved.id,
      entityLabel: saved.address,
      actor: { id: user.id, email: user.email },
      before: beforeMailbox,
      after: saved as unknown as Record<string, unknown>,
      fields: [
        "address",
        "name",
        "sendAsAddress",
        "boardId",
        "fallbackClientId",
        "defaultPriority",
        "provider",
        "inbound",
        "outbound",
        "active",
        "signature",
        "ignoreBefore",
      ],
    });

    await audit({
      action: "SF_MAILBOX_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: `silverfang:mailbox:${saved.id}`,
      metadata: {
        address: saved.address,
        provider: saved.provider,
        inbound: saved.inbound,
        outbound: saved.outbound,
        active: saved.active,
      },
    });
    revalidatePath("/silverfang/email");
    return {
      ok: true,
      message:
        input.provider === "RESEND" && input.inbound
          ? "Mailbox saved. Resend cannot be polled, so inbound mail must arrive through the webhook — Graph polling will skip this mailbox."
          : "Mailbox saved.",
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Poll every inbound mailbox now, rather than waiting for the cron. */
export async function pollMailboxesAction(
  _prev: SfActionResult | null,
  _formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const { pollAllMailboxes } = await import("@/lib/silverfang/email-ingest");
    const results = await pollAllMailboxes(25);
    if (results.length === 0) {
      return { ok: false, message: "No active inbound mailbox is configured." };
    }
    await audit({
      action: "SILVERFANG_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: "silverfang:mailbox-poll",
      metadata: { mailboxes: results.length },
    });
    revalidatePath("/silverfang/email");
    revalidatePath("/silverfang/tickets");

    const failed = results.filter((r) => !r.ok);
    const totals = results.reduce(
      (a, r) => ({
        fetched: a.fetched + r.fetched,
        created: a.created + r.created,
        appended: a.appended + r.appended,
        deduped: a.deduped + r.deduped,
      }),
      { fetched: 0, created: 0, appended: 0, deduped: 0 },
    );
    // Merge the per-mailbox skip tallies, then let the shared vocabulary name them.
    // This used to print raw reason slugs ("2 unknown-sender") and, worse, reported
    // an empty mailbox and a mailbox where everything was skipped identically.
    const skipped: Record<string, number> = {};
    for (const r of results) {
      for (const [reason, count] of Object.entries(r.skipped)) {
        skipped[reason] = (skipped[reason] ?? 0) + count;
      }
    }
    const { summarizePoll } = await import("@/lib/silverfang/ingest-outcomes");
    const summary = summarizePoll({ ...totals, skipped }) + ".";

    return failed.length > 0
      ? {
          ok: false,
          message: `${summary} ${failed.length} mailbox(es) failed: ${failed
            .map((f) => `${f.mailbox} — ${f.error ?? "unknown error"}`)
            .join("; ")}`,
        }
      : { ok: true, message: summary };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/**
 * Diagnose mail: report which app the Graph token actually belongs to and what
 * roles it carries, then test reading and sending independently. Optionally sends
 * a real test message to the address given.
 */
export async function diagnoseMailAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const { diagnoseMail } = await import("@/lib/silverfang/mail-diagnostics");
    const sendTo = formValue(formData, "sendTo");
    const d = await diagnoseMail({ trySend: Boolean(sendTo), sendTo });

    const lines: string[] = [];
    lines.push(
      `Token app: ${d.tokenAppId ?? "unknown"}${
        d.appIdMatches === false ? ` — MISMATCH, Wolf365 is configured with ${d.configuredAppId}` : ""
      }`,
    );
    lines.push(`Tenant: ${d.tenantId ?? "unknown"}`);
    lines.push(`Application roles on the token: ${d.roles.length ? d.roles.join(", ") : "NONE"}`);
    lines.push(
      `Read ${d.mailbox ?? "(no mailbox)"}: ${d.read.ok ? "OK" : `HTTP ${d.read.status} ${d.read.detail ?? ""}`}`,
    );
    if (d.send) {
      lines.push(
        `Send as ${d.sendAs}: ${d.send.ok ? "OK — check the inbox" : `HTTP ${d.send.status} ${d.send.detail ?? ""}`}`,
      );
    }
    for (const n of d.notes) lines.push(`• ${n}`);

    await audit({
      action: "SILVERFANG_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: "silverfang:mail-diagnostics",
      metadata: {
        tokenAppId: d.tokenAppId,
        appIdMatches: d.appIdMatches,
        roles: d.roles,
        readStatus: d.read.status,
        sendStatus: d.send?.status ?? null,
      },
    });

    const healthy = d.read.ok && (!d.send || d.send.ok);
    return { ok: healthy, message: lines.join("\n") };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Turn an auto-response rule on or off. */
export async function toggleAutoResponseAction(formData: FormData): Promise<void> {
  const user = await requirePermission("silverfang:configure");
  const id = z.string().min(1).parse(formData.get("ruleId"));
  const rule = await prisma.sfAutoResponseRule.findUnique({ where: { id } });
  if (!rule) return;
  await prisma.sfAutoResponseRule.update({
    where: { id },
    data: { active: !rule.active },
  });
  await audit({
    action: "SILVERFANG_CONFIG_CHANGED",
    actorId: user.id,
    actorEmail: user.email,
    target: `silverfang:autoResponse:${id}`,
    metadata: { name: rule.name, active: !rule.active },
  });
  revalidatePath("/silverfang/email");
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Seed the default board, statuses, SLA and charge codes. */
export async function seedSilverFangAction(
  _prev: SfActionResult | null,
  _formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const result = await ensureSilverFangDefaults();
    await audit({
      action: "SILVERFANG_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: "silverfang:seed",
      metadata: { created: result.created },
    });
    revalidatePath("/silverfang/setup");
    revalidatePath("/silverfang/tickets");
    return {
      ok: true,
      message: result.created
        ? "Default board, statuses, SLA and charge codes created."
        : "Defaults already in place — nothing to create.",
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

const techProfileSchema = z.object({
  userId: z.string().min(1),
  calendarMailbox: z.preprocess(
    emptyToUndefined,
    z.string().email("The calendar mailbox must be an email address").max(200).optional(),
  ),
  calendarSyncEnabled: z.coerce.boolean(),
});

/**
 * Save one technician's calendar settings.
 *
 * Upserts the profile, because most users have no SfTechProfile row until
 * something needs one — requiring it to exist first would mean nobody could ever
 * enable sync.
 *
 * Refuses to enable sync without a mailbox. That combination is not dangerous, it
 * is just silently inert, and "I turned it on and nothing happened" is a worse
 * outcome than being told why up front.
 */
export async function saveTechProfileAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const actor = await requirePermission("silverfang:configure");
  try {
    const input = techProfileSchema.parse({
      userId: formValue(formData, "userId"),
      calendarMailbox: formValue(formData, "calendarMailbox"),
      calendarSyncEnabled: formData.get("calendarSyncEnabled") === "on",
    });

    if (input.calendarSyncEnabled && !input.calendarMailbox) {
      return {
        ok: false,
        message: "Set a calendar mailbox before enabling sync — without one nothing is written.",
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    });
    if (!user) return { ok: false, message: "That user no longer exists." };

    await prisma.sfTechProfile.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        calendarMailbox: input.calendarMailbox ?? null,
        calendarSyncEnabled: input.calendarSyncEnabled,
      },
      update: {
        calendarMailbox: input.calendarMailbox ?? null,
        calendarSyncEnabled: input.calendarSyncEnabled,
      },
    });

    await audit({
      action: "SILVERFANG_CONFIG_CHANGED",
      actorId: actor.id,
      actorEmail: actor.email,
      target: `silverfang:techProfile:${input.userId}`,
      // Writing to someone's calendar is worth an audit trail naming who enabled
      // it and for which mailbox.
      metadata: {
        subject: user.email,
        calendarMailbox: input.calendarMailbox ?? null,
        calendarSyncEnabled: input.calendarSyncEnabled,
      },
    });
    revalidatePath("/silverfang/setup");
    return {
      ok: true,
      message: input.calendarSyncEnabled
        ? `Calendar sync on for ${input.calendarMailbox}. Blocks with a start and end time appear there from now on; existing ones sync when next edited.`
        : "Calendar sync off. Events already written stay put until their block is edited or deleted.",
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
