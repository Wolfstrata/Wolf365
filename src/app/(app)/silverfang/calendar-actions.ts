"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import { timeEntryEditable } from "@/lib/silverfang/status";
import { hoursBetweenMinutes, instantFor, timeToMinutes } from "@/lib/silverfang/calendar";
import { parseDateKey } from "@/lib/silverfang/timesheet";
import { roundHours } from "@/lib/silverfang/time";
import {
  nextTicketNumber,
  resolveTimeEntryRate,
  slaDueDatesFor,
} from "@/lib/silverfang/service";
import type { SfActionResult } from "./actions";

/**
 * Time blocks drawn on the calendar.
 *
 * Different from the list-based entry form in two ways that matter: it carries
 * start/end wall-clock times, and it can attach to a ticket, a project task, or
 * an agreement alone — or open a ticket on the spot, which is the common case
 * when someone drops a block on the calendar for work that has no ticket yet.
 */

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;
const optionalId = z.preprocess(emptyToUndefined, z.string().min(1).optional());

function formValue(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
}

const blockSchema = z.object({
  id: optionalId,
  /** "YYYY-MM-DD" of the day clicked. */
  day: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  /** Viewer's UTC offset in minutes, so a block lands on the clock they saw. */
  offsetMinutes: z.coerce.number().int().min(-840).max(840),
  chargeCodeId: z.string().min(1, "Pick a charge code"),
  ticketId: optionalId,
  projectTaskId: optionalId,
  agreementId: optionalId,
  /** When set with no ticketId, a ticket is created for this client. */
  newTicketClientId: optionalId,
  newTicketSummary: z.preprocess(emptyToUndefined, z.string().max(300).optional()),
  notes: z.preprocess(emptyToUndefined, z.string().max(5_000).optional()),
  billable: z.coerce.boolean(),
  internalOnly: z.coerce.boolean(),
});

/** Create or update one calendar time block. */
export async function saveTimeBlockAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("time:log");
  try {
    const input = blockSchema.parse({
      id: formValue(formData, "id"),
      day: formValue(formData, "day"),
      startTime: formValue(formData, "startTime"),
      endTime: formValue(formData, "endTime"),
      offsetMinutes: formValue(formData, "offsetMinutes"),
      chargeCodeId: formValue(formData, "chargeCodeId"),
      ticketId: formValue(formData, "ticketId"),
      projectTaskId: formValue(formData, "projectTaskId"),
      agreementId: formValue(formData, "agreementId"),
      newTicketClientId: formValue(formData, "newTicketClientId"),
      newTicketSummary: formValue(formData, "newTicketSummary"),
      notes: formValue(formData, "notes"),
      billable: formData.get("billable") === "on",
      internalOnly: formData.get("internalOnly") === "on",
    });

    const workDate = parseDateKey(input.day);
    if (!workDate) return { ok: false, message: "That day is not a valid date." };
    const startMinutes = timeToMinutes(input.startTime);
    const endMinutes = timeToMinutes(input.endTime);
    if (startMinutes == null || endMinutes == null) {
      return { ok: false, message: "Enter times as HH:MM, e.g. 09:30." };
    }
    if (endMinutes <= startMinutes) {
      return { ok: false, message: "The end time has to be after the start time." };
    }
    const hours = roundHours(hoursBetweenMinutes(startMinutes, endMinutes));
    if (hours <= 0) return { ok: false, message: "That block is too short to record." };

    let ticketId = input.ticketId ?? null;
    let createdTicketNumber: number | null = null;

    // Open a ticket for the block when asked. Done before the entry so a failure
    // here doesn't leave orphaned time.
    if (!ticketId && input.newTicketClientId) {
      const summary = input.newTicketSummary?.trim();
      if (!summary) {
        return { ok: false, message: "Give the new ticket a summary." };
      }
      const board = await prisma.sfBoard.findFirst({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
        include: { statuses: { orderBy: { sortOrder: "asc" } } },
      });
      const status = board?.statuses.find((s) => s.isDefault) ?? board?.statuses[0];
      if (!board || !status) {
        return {
          ok: false,
          message: "No active board with statuses exists — run SilverFang Setup first.",
        };
      }
      const openedAt = instantFor(workDate, startMinutes, input.offsetMinutes);
      const sla = await slaDueDatesFor(board.slaId, "P3", openedAt);
      const created = await prisma.$transaction(async (tx) => {
        const number = await nextTicketNumber(tx);
        return tx.sfTicket.create({
          data: {
            number,
            clientId: input.newTicketClientId!,
            boardId: board.id,
            statusId: status.id,
            priority: "P3",
            source: "PHONE",
            summary,
            agreementId: input.agreementId ?? null,
            projectTaskId: input.projectTaskId ?? null,
            slaId: board.slaId,
            responseDueAt: sla.responseDueAt,
            resolutionDueAt: sla.resolutionDueAt,
            openedAt,
            createdById: user.id,
            createdByEmail: user.email,
            slaEvents: { create: { kind: "STARTED", note: "Opened from the time calendar" } },
          },
        });
      });
      ticketId = created.id;
      createdTicketNumber = created.number;
      await audit({
        action: "TICKET_CREATED",
        actorId: user.id,
        actorEmail: user.email,
        target: `sfTicket:${created.id}`,
        metadata: { number: created.number, fromCalendar: true },
      });
    }

    // Work out the client for rate resolution: the ticket's, else the task's
    // project, else the agreement's.
    const ticket = ticketId
      ? await prisma.sfTicket.findUnique({
          where: { id: ticketId },
          select: { id: true, clientId: true, agreementId: true, number: true },
        })
      : null;
    const task = input.projectTaskId
      ? await prisma.sfProjectTask.findUnique({
          where: { id: input.projectTaskId },
          select: { id: true, project: { select: { clientId: true, agreementId: true } } },
        })
      : null;
    const agreement = input.agreementId
      ? await prisma.sfAgreement.findUnique({
          where: { id: input.agreementId },
          select: { id: true, clientId: true },
        })
      : null;

    const clientId = ticket?.clientId ?? task?.project.clientId ?? agreement?.clientId ?? null;
    if (!clientId) {
      return {
        ok: false,
        message:
          "Attach the block to a ticket, a project task, or an agreement — time has to belong to a client to be rated or billed.",
      };
    }
    const effectiveAgreementId =
      input.agreementId ?? ticket?.agreementId ?? task?.project.agreementId ?? null;

    const workedAt = instantFor(workDate, startMinutes, input.offsetMinutes);
    const resolved = await resolveTimeEntryRate({
      clientId,
      chargeCodeId: input.chargeCodeId,
      agreementId: effectiveAgreementId,
      userId: user.id,
      workedAt,
      hours,
      billable: input.billable,
    });

    const data = {
      userId: user.id,
      ticketId,
      projectTaskId: input.projectTaskId ?? null,
      agreementId: effectiveAgreementId,
      chargeCodeId: input.chargeCodeId,
      workDate,
      startedAt: workedAt,
      endedAt: instantFor(workDate, endMinutes, input.offsetMinutes),
      hours,
      notes: input.notes ?? null,
      internalOnly: input.internalOnly,
      billable: input.billable,
      timeBand: resolved.timeBand,
      rate: resolved.rate,
      costRate: resolved.costRate,
      amount: resolved.amount,
    };

    if (input.id) {
      const existing = await prisma.sfTimeEntry.findUnique({ where: { id: input.id } });
      if (!existing) return { ok: false, message: "That time block no longer exists." };
      if (existing.userId !== user.id) await requirePermission("time:approve");
      if (!timeEntryEditable(existing.status)) {
        return {
          ok: false,
          message: `This block is ${existing.status.toLowerCase()} and can no longer be edited.`,
        };
      }
      await prisma.sfTimeEntry.update({ where: { id: input.id }, data });
    } else {
      await prisma.sfTimeEntry.create({ data });
    }

    if (ticketId) {
      const { recomputeTicketHours } = await import("@/lib/silverfang/service");
      await recomputeTicketHours(ticketId);
    }

    await audit({
      action: input.id ? "TIME_ENTRY_UPDATED" : "TIME_LOGGED",
      actorId: user.id,
      actorEmail: user.email,
      target: ticketId ? `sfTicket:${ticketId}` : `silverfang:client:${clientId}`,
      metadata: { hours, billable: input.billable, fromCalendar: true },
    });
    revalidatePath("/silverfang/time");
    revalidatePath("/silverfang/timesheets");
    if (ticketId) revalidatePath(`/silverfang/tickets/${ticketId}`);

    const rateNote =
      resolved.rate == null && input.billable
        ? " No rate resolved, so it has no value yet — add a rate rule or an agreement rate."
        : "";
    return {
      ok: true,
      message:
        (createdTicketNumber
          ? `Logged ${hours}h and opened ticket #${createdTicketNumber}.`
          : `Logged ${hours}h.`) + rateNote,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Delete a block from the calendar. */
export async function deleteTimeBlockAction(formData: FormData): Promise<void> {
  const user = await requirePermission("time:log");
  const id = z.string().min(1).parse(formData.get("id"));
  const entry = await prisma.sfTimeEntry.findUnique({ where: { id } });
  if (!entry) return;
  if (entry.userId !== user.id) await requirePermission("time:approve");
  if (!timeEntryEditable(entry.status)) return;

  await prisma.sfTimeEntry.delete({ where: { id } });
  if (entry.ticketId) {
    const { recomputeTicketHours } = await import("@/lib/silverfang/service");
    await recomputeTicketHours(entry.ticketId);
  }
  await audit({
    action: "TIME_ENTRY_UPDATED",
    actorId: user.id,
    actorEmail: user.email,
    target: entry.ticketId ? `sfTicket:${entry.ticketId}` : "silverfang:time",
    metadata: { deleted: true, hours: Number(entry.hours) },
  });
  revalidatePath("/silverfang/time");
  revalidatePath("/silverfang/timesheets");
}
