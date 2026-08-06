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
    type: formValue(formData, "type"),
    subtype: formValue(formData, "subtype"),
    estimatedHours: formValue(formData, "estimatedHours"),
  });
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
            description: input.description ?? null,
            assigneeId: input.assigneeId ?? null,
            agreementId: input.agreementId ?? null,
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
          description: input.description ?? null,
          assigneeId: input.assigneeId ?? null,
          agreementId: input.agreementId ?? null,
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
          body: input.body,
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
  workDate: z.coerce.date(),
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

    const workDate = toWorkDate(input.workDate);
    const resolved = await resolveTimeEntryRate({
      clientId: ticket.clientId,
      chargeCodeId: input.chargeCodeId,
      agreementId: ticket.agreementId,
      userId: user.id,
      workedAt: input.workDate,
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
      vip: formData.get("vip") === "on",
      notes: formValue(formData, "notes"),
    });

    const client = await prisma.client.findUnique({ where: { id: input.clientId } });
    if (!client) return { ok: false, message: "That client no longer exists." };

    const data = {
      accountManager: input.accountManager ?? null,
      defaultBoardId: input.defaultBoardId ?? null,
      defaultAgreementId: input.defaultAgreementId ?? null,
      vip: input.vip,
      notes: input.notes ?? null,
    };
    await prisma.sfClientProfile.upsert({
      where: { clientId: input.clientId },
      create: { clientId: input.clientId, ...data },
      update: data,
    });

    await audit({
      action: "SILVERFANG_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: `silverfang:clientProfile:${input.clientId}`,
      metadata: { vip: input.vip, hasAccountManager: Boolean(input.accountManager) },
    });
    revalidatePath(`/silverfang/clients/${input.clientId}`);
    revalidatePath("/silverfang/clients");
    return { ok: true, message: "Client profile saved." };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
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
