"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import { assertTimesheetTransition } from "@/lib/silverfang/status";
import { canSubmit, parseDateKey, totalsFor, weekRange } from "@/lib/silverfang/timesheet";
import type { SfActionResult } from "./actions";

/**
 * Timesheet submit → approve workflow.
 *
 * A week is a container for entries that already exist; submitting attaches them
 * and freezes editing, approval makes them billable. Entry status moves with the
 * timesheet so a tech can't edit approved time and an approver can't approve time
 * that was never submitted — both enforced by the state machine, not by the UI.
 */

function formValue(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
}

/** Find or create the week container for a user. */
async function ensureTimesheet(userId: string, weekStart: Date) {
  const existing = await prisma.sfTimesheet.findUnique({
    where: { userId_weekStart: { userId, weekStart } },
  });
  if (existing) return existing;
  return prisma.sfTimesheet.create({ data: { userId, weekStart } });
}

/** Submit a week for approval. */
export async function submitTimesheetAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("time:log");
  try {
    const weekStart = parseDateKey(formValue(formData, "weekStart"));
    if (!weekStart) return { ok: false, message: "That week is not a valid date." };

    const range = weekRange(weekStart);
    const entries = await prisma.sfTimeEntry.findMany({
      where: { userId: user.id, workDate: range },
      select: { id: true, hours: true, billable: true, workDate: true, status: true },
    });

    const sheet = await ensureTimesheet(user.id, weekStart);
    const gate = canSubmit({ status: sheet.status, entryCount: entries.length });
    if (!gate.ok) return { ok: false, message: gate.reason };
    assertTimesheetTransition(sheet.status, "SUBMITTED");

    const totals = totalsFor(
      entries.map((e) => ({
        workDate: e.workDate,
        hours: Number(e.hours),
        billable: e.billable,
      })),
    );

    await prisma.$transaction([
      // Attach every entry in the week and move the editable ones to SUBMITTED.
      prisma.sfTimeEntry.updateMany({
        where: { userId: user.id, workDate: range },
        data: { timesheetId: sheet.id },
      }),
      prisma.sfTimeEntry.updateMany({
        where: {
          userId: user.id,
          workDate: range,
          status: { in: ["DRAFT", "REJECTED"] },
        },
        data: { status: "SUBMITTED" },
      }),
      prisma.sfTimesheet.update({
        where: { id: sheet.id },
        data: {
          status: "SUBMITTED",
          submittedAt: new Date(),
          rejectionNote: null,
          totalHours: totals.totalHours,
          billableHours: totals.billableHours,
        },
      }),
    ]);

    await audit({
      action: "TIMESHEET_SUBMITTED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfTimesheet:${sheet.id}`,
      metadata: {
        weekStart: weekStart.toISOString().slice(0, 10),
        entries: entries.length,
        totalHours: totals.totalHours,
      },
    });
    revalidatePath("/silverfang/timesheets");
    revalidatePath("/silverfang/time");
    return {
      ok: true,
      message: `Week submitted — ${totals.totalHours}h (${totals.billableHours}h billable) awaiting approval.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

const decisionSchema = z.object({
  timesheetId: z.string().min(1),
  note: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().max(2_000).optional(),
  ),
});

/**
 * Approve a submitted week. Approved time is what billing may draw on, so this
 * needs `time:approve` and an approver cannot approve their own week.
 */
export async function approveTimesheetAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("time:approve");
  try {
    const input = decisionSchema.parse({
      timesheetId: formValue(formData, "timesheetId"),
      note: formValue(formData, "note"),
    });
    const sheet = await prisma.sfTimesheet.findUnique({
      where: { id: input.timesheetId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!sheet) return { ok: false, message: "That timesheet no longer exists." };
    if (sheet.userId === user.id) {
      return {
        ok: false,
        message:
          "You can't approve your own timesheet. Approved time becomes billable, so it needs a second pair of eyes.",
      };
    }
    assertTimesheetTransition(sheet.status, "APPROVED");

    await prisma.$transaction([
      prisma.sfTimeEntry.updateMany({
        where: { timesheetId: sheet.id, status: "SUBMITTED" },
        data: { status: "APPROVED" },
      }),
      prisma.sfTimesheet.update({
        where: { id: sheet.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedById: user.id,
          approvedByEmail: user.email,
          rejectionNote: null,
        },
      }),
    ]);

    await audit({
      action: "TIMESHEET_APPROVED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfTimesheet:${sheet.id}`,
      metadata: {
        forUser: sheet.user.email,
        weekStart: sheet.weekStart.toISOString().slice(0, 10),
        totalHours: Number(sheet.totalHours),
      },
    });
    revalidatePath("/silverfang/timesheets");
    return {
      ok: true,
      message: `Approved ${sheet.user.name ?? sheet.user.email}'s week — ${Number(sheet.totalHours)}h is now billable.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Send a week back to the tech, with a reason. */
export async function rejectTimesheetAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("time:approve");
  try {
    const input = decisionSchema.parse({
      timesheetId: formValue(formData, "timesheetId"),
      note: formValue(formData, "note"),
    });
    if (!input.note) {
      return {
        ok: false,
        message: "Add a reason — a week sent back without one just gets resubmitted unchanged.",
      };
    }
    const sheet = await prisma.sfTimesheet.findUnique({
      where: { id: input.timesheetId },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!sheet) return { ok: false, message: "That timesheet no longer exists." };
    assertTimesheetTransition(sheet.status, "REJECTED");

    await prisma.$transaction([
      prisma.sfTimeEntry.updateMany({
        where: { timesheetId: sheet.id, status: "SUBMITTED" },
        data: { status: "REJECTED" },
      }),
      prisma.sfTimesheet.update({
        where: { id: sheet.id },
        data: { status: "REJECTED", rejectionNote: input.note, submittedAt: null },
      }),
    ]);

    await audit({
      action: "TIMESHEET_SUBMITTED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfTimesheet:${sheet.id}`,
      metadata: { rejected: true, forUser: sheet.user.email },
    });
    revalidatePath("/silverfang/timesheets");
    return {
      ok: true,
      message: `Sent back to ${sheet.user.name ?? sheet.user.email} — their entries are editable again.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Reopen a submitted week so the tech can amend it before approval. */
export async function reopenTimesheetAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("time:log");
  try {
    const id = z.string().min(1).parse(formValue(formData, "timesheetId"));
    const sheet = await prisma.sfTimesheet.findUnique({ where: { id } });
    if (!sheet) return { ok: false, message: "That timesheet no longer exists." };
    // A tech may pull back their own week; anything else needs an approver.
    if (sheet.userId !== user.id) await requirePermission("time:approve");
    assertTimesheetTransition(sheet.status, "OPEN");

    await prisma.$transaction([
      prisma.sfTimeEntry.updateMany({
        where: { timesheetId: sheet.id, status: "SUBMITTED" },
        data: { status: "DRAFT" },
      }),
      prisma.sfTimesheet.update({
        where: { id: sheet.id },
        data: { status: "OPEN", submittedAt: null },
      }),
    ]);
    revalidatePath("/silverfang/timesheets");
    revalidatePath("/silverfang/time");
    return { ok: true, message: "Week reopened — entries are editable again." };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
