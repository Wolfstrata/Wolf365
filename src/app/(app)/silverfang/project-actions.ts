"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SfProjectBillingType, SfProjectStatus, SfTaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import { recordChanges } from "@/lib/silverfang/change-log";
import { describeChanges } from "@/lib/silverfang/changes";
import {
  defaultPhaseNames,
  depositAmountFor,
  projectTotal,
  splitHoursAcrossPhases,
} from "@/lib/silverfang/project-billing";
import { parseTemplateTasks } from "@/lib/silverfang/project-templates";
import type { SfActionResult } from "./actions";

/** Projects, their task lists, and templates that stamp out standard task sets. */

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;
const optionalId = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalNumber = z.preprocess(
  emptyToUndefined,
  z.coerce.number().min(0).max(100_000_000).optional(),
);
const optionalDate = z.preprocess(emptyToUndefined, z.coerce.date().optional());

function formValue(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
}

const projectSchema = z.object({
  id: optionalId,
  clientId: z.string().min(1, "Select a client"),
  agreementId: optionalId,
  templateId: optionalId,
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.preprocess(emptyToUndefined, z.string().max(20_000).optional()),
  status: z.enum(SfProjectStatus),
  managerId: optionalId,
  startDate: optionalDate,
  dueDate: optionalDate,
  contractedHours: optionalNumber,
  estimatedHours: optionalNumber,
  budgetAmount: optionalNumber,
  billingType: z.enum(SfProjectBillingType),
  fixedFeeAmount: optionalNumber,
  billingIntervalDays: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(3_650).optional(),
  ),
  depositPercent: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(0).max(100).optional(),
  ),
  /** Creation only: how many "Phase n" rows to stamp out. */
  phaseCount: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(50).optional(),
  ),
});

const PROJECT_FIELDS = [
  "clientId",
  "agreementId",
  "name",
  "description",
  "status",
  "managerId",
  "startDate",
  "dueDate",
  "contractedHours",
  "estimatedHours",
  "budgetAmount",
  "billingType",
  "fixedFeeAmount",
  "billingIntervalDays",
  "depositPercent",
];

/**
 * Create or update a project. On creation, a chosen template stamps out its task
 * list — with due dates derived from the project start plus each task's offset,
 * which is the point of a template being relative rather than dated.
 */
export async function saveProjectAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("projects:manage");
  try {
    const input = projectSchema.parse({
      id: formValue(formData, "id"),
      clientId: formValue(formData, "clientId"),
      agreementId: formValue(formData, "agreementId"),
      templateId: formValue(formData, "templateId"),
      name: formValue(formData, "name"),
      description: formValue(formData, "description"),
      status: formValue(formData, "status"),
      managerId: formValue(formData, "managerId"),
      startDate: formValue(formData, "startDate"),
      dueDate: formValue(formData, "dueDate"),
      contractedHours: formValue(formData, "contractedHours"),
      estimatedHours: formValue(formData, "estimatedHours"),
      budgetAmount: formValue(formData, "budgetAmount"),
      billingType: formValue(formData, "billingType") ?? "TIME_AND_MATERIALS",
      fixedFeeAmount: formValue(formData, "fixedFeeAmount"),
      billingIntervalDays: formValue(formData, "billingIntervalDays"),
      depositPercent: formValue(formData, "depositPercent"),
      phaseCount: formValue(formData, "phaseCount"),
    });

    if (input.startDate && input.dueDate && input.dueDate < input.startDate) {
      return { ok: false, message: "The due date cannot be before the start date." };
    }
    if (input.billingType === "FIXED_FEE" && input.fixedFeeAmount == null) {
      return {
        ok: false,
        message: "A fixed-fee project needs its fee amount — that is the whole basis of the billing.",
      };
    }
    const client = await prisma.client.findUnique({
      where: { id: input.clientId },
      select: { id: true, name: true },
    });
    if (!client) return { ok: false, message: "That client no longer exists." };

    const total = projectTotal({
      billingType: input.billingType,
      fixedFeeAmount: input.fixedFeeAmount ?? null,
      budgetAmount: input.budgetAmount ?? null,
    });
    if (input.depositPercent != null && input.depositPercent > 0 && total == null) {
      return {
        ok: false,
        message:
          input.billingType === "FIXED_FEE"
            ? "A deposit is a percentage of the fee, so set the fixed-fee amount first."
            : "A deposit is a percentage of the total, so set the budget first.",
      };
    }

    const data = {
      clientId: input.clientId,
      agreementId: input.agreementId ?? null,
      name: input.name,
      description: input.description ?? null,
      status: input.status,
      managerId: input.managerId ?? null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      contractedHours: input.contractedHours ?? null,
      estimatedHours: input.estimatedHours ?? null,
      budgetAmount: input.budgetAmount ?? null,
      billingType: input.billingType,
      fixedFeeAmount: input.fixedFeeAmount ?? null,
      billingIntervalDays: input.billingIntervalDays ?? 30,
      depositPercent:
        input.depositPercent != null && input.depositPercent > 0 ? input.depositPercent : null,
    };

    const before = input.id
      ? await prisma.sfProject.findUnique({ where: { id: input.id } })
      : null;

    // The deposit amount is recomputed while it is still only a plan, and frozen
    // the moment it has been invoiced — a later change to the total must not
    // rewrite an amount that already went to the client.
    const depositAmount = depositAmountFor(total, data.depositPercent);
    const depositFrozen = before?.depositInvoicedAt != null;

    let saved;
    let tasksCreated = 0;
    let phasesCreated = 0;
    if (input.id) {
      saved = await prisma.sfProject.update({
        where: { id: input.id },
        data: { ...data, ...(depositFrozen ? {} : { depositAmount }) },
      });
    } else {
      const template = input.templateId
        ? await prisma.sfProjectTemplate.findUnique({
            where: { id: input.templateId },
            include: { tasks: { orderBy: { sortOrder: "asc" } } },
          })
        : null;
      const base = input.startDate ?? new Date();
      // Phases are stamped out as "Phase 1…n" and renamed later. Contracted hours
      // are split across them so the parts sum to the whole from the start
      // rather than leaving every phase blank.
      const phaseNames = defaultPhaseNames(input.phaseCount ?? 0);
      const phaseHours = splitHoursAcrossPhases(
        input.contractedHours ?? null,
        phaseNames.length,
      );
      saved = await prisma.sfProject.create({
        data: {
          ...data,
          depositAmount,
          templateId: template?.id ?? null,
          createdById: user.id,
          createdByEmail: user.email,
          ...(phaseNames.length > 0
            ? {
                phases: {
                  create: phaseNames.map((name, i) => ({
                    name,
                    sortOrder: i * 10,
                    hours: phaseHours[i] ?? null,
                  })),
                },
              }
            : {}),
          ...(template && template.tasks.length > 0
            ? {
                tasks: {
                  create: template.tasks.map((t) => ({
                    phase: t.phase,
                    name: t.name,
                    description: t.description,
                    sortOrder: t.sortOrder,
                    estimatedHours: t.estimatedHours,
                    dueDate:
                      t.dueOffsetDays != null
                        ? new Date(base.getTime() + t.dueOffsetDays * 86_400_000)
                        : null,
                  })),
                },
              }
            : {}),
        },
      });
      tasksCreated = template?.tasks.length ?? 0;
      phasesCreated = phaseNames.length;
    }

    const changes = await recordChanges({
      entity: "SfProject",
      entityId: saved.id,
      entityLabel: `${client.name} — ${saved.name}`,
      actor: { id: user.id, email: user.email },
      before,
      after: saved as unknown as Record<string, unknown>,
      fields: PROJECT_FIELDS,
    });

    await audit({
      action: input.id ? "PROJECT_UPDATED" : "PROJECT_CREATED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfProject:${saved.id}`,
      metadata: {
        clientId: input.clientId,
        status: input.status,
        billingType: input.billingType,
        tasksCreated,
        phasesCreated,
      },
    });
    revalidatePath("/silverfang/projects");
    revalidatePath(`/silverfang/projects/${saved.id}`);
    revalidatePath(`/silverfang/clients/${input.clientId}`);

    const created = [
      phasesCreated > 0 ? `${phasesCreated} phase(s)` : null,
      tasksCreated > 0 ? `${tasksCreated} task(s) from the template` : null,
    ].filter(Boolean);
    return {
      ok: true,
      message: input.id
        ? changes.length === 0
          ? "No changes to save."
          : `Saved ${describeChanges(changes)}.`
        : created.length > 0
          ? `Project created with ${created.join(" and ")}.`
          : "Project created.",
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

const phaseSchema = z.object({
  id: optionalId,
  projectId: z.string().min(1),
  name: z.string().trim().min(1, "A phase needs a name").max(120),
  hours: optionalNumber,
  status: z.enum(SfTaskStatus),
  notes: z.preprocess(emptyToUndefined, z.string().max(20_000).optional()),
  sortOrder: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(9_999).optional()),
});

/**
 * Create or rename one phase, and set the hours sold for it. Phase hours sum to
 * the project's contracted total; a mismatch is surfaced on the project page
 * rather than refused here, because a project is reshaped a field at a time and
 * blocking every intermediate state would make it uneditable.
 */
export async function saveProjectPhaseAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("projects:manage");
  try {
    const input = phaseSchema.parse({
      id: formValue(formData, "id"),
      projectId: formValue(formData, "projectId"),
      name: formValue(formData, "name"),
      hours: formValue(formData, "hours"),
      status: formValue(formData, "status") ?? "NOT_STARTED",
      notes: formValue(formData, "notes"),
      sortOrder: formValue(formData, "sortOrder"),
    });

    const project = await prisma.sfProject.findUnique({
      where: { id: input.projectId },
      select: { id: true, name: true, clientId: true, _count: { select: { phases: true } } },
    });
    if (!project) return { ok: false, message: "That project no longer exists." };

    const data = {
      projectId: input.projectId,
      name: input.name,
      hours: input.hours ?? null,
      status: input.status,
      notes: input.notes ?? null,
      // A new phase goes to the end; an existing one keeps its place unless moved.
      sortOrder: input.sortOrder ?? project._count.phases * 10,
    };

    const before = input.id
      ? await prisma.sfProjectPhase.findUnique({ where: { id: input.id } })
      : null;
    if (input.id && !before) return { ok: false, message: "That phase no longer exists." };
    if (before && before.projectId !== input.projectId) {
      return { ok: false, message: "That phase belongs to a different project." };
    }

    const saved = input.id
      ? await prisma.sfProjectPhase.update({ where: { id: input.id }, data })
      : await prisma.sfProjectPhase.create({ data });

    const changes = await recordChanges({
      entity: "SfProjectPhase",
      entityId: saved.id,
      entityLabel: `${project.name} — ${saved.name}`,
      actor: { id: user.id, email: user.email },
      before,
      after: saved as unknown as Record<string, unknown>,
      fields: ["name", "hours", "status", "notes", "sortOrder"],
    });
    await audit({
      action: "PROJECT_UPDATED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfProject:${input.projectId}`,
      metadata: { phaseId: saved.id, phase: saved.name },
    });
    revalidatePath(`/silverfang/projects/${input.projectId}`);
    return {
      ok: true,
      message: input.id
        ? changes.length === 0
          ? "No changes to save."
          : `Saved ${describeChanges(changes)}.`
        : `Added ${saved.name}.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/**
 * Add the next default phase ("Phase n") to a project — one click, because the
 * common case is extending the sequence rather than naming something new.
 */
export async function addNextProjectPhaseAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects:manage");
  const projectId = z.string().min(1).parse(formData.get("projectId"));
  const project = await prisma.sfProject.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, phases: { select: { sortOrder: true } } },
  });
  if (!project) return;
  if (project.phases.length >= 50) return;

  const phase = await prisma.sfProjectPhase.create({
    data: {
      projectId,
      name: `Phase ${project.phases.length + 1}`,
      sortOrder: Math.max(0, ...project.phases.map((p) => p.sortOrder)) + 10,
    },
  });
  await recordChanges({
    entity: "SfProjectPhase",
    entityId: phase.id,
    entityLabel: `${project.name} — ${phase.name}`,
    actor: { id: user.id, email: user.email },
    before: null,
    after: phase as unknown as Record<string, unknown>,
    fields: [],
  });
  revalidatePath(`/silverfang/projects/${projectId}`);
}

/**
 * Delete a phase. Refused once tickets, tasks or time reference it: removing it
 * would orphan the work from the stage it was done in, and the hours it holds
 * are part of what was sold.
 */
export async function deleteProjectPhaseAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("projects:manage");
  try {
    const id = z.string().min(1).parse(formValue(formData, "id"));
    const phase = await prisma.sfProjectPhase.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        projectId: true,
        _count: { select: { tickets: true, tasks: true, timeEntries: true } },
      },
    });
    if (!phase) return { ok: false, message: "That phase no longer exists." };

    const { tickets, tasks, timeEntries } = phase._count;
    if (tickets + tasks + timeEntries > 0) {
      return {
        ok: false,
        message:
          `${phase.name} has ${tickets} ticket(s), ${tasks} task(s) and ${timeEntries} time ` +
          `entr(ies) against it. Move them to another phase first — deleting it would cut that ` +
          `work loose from the stage it belongs to.`,
      };
    }

    await prisma.sfProjectPhase.delete({ where: { id } });
    await recordChanges({
      entity: "SfProjectPhase",
      entityId: id,
      entityLabel: phase.name,
      actor: { id: user.id, email: user.email },
      before: phase as unknown as Record<string, unknown>,
      after: null,
      fields: [],
    });
    await audit({
      action: "PROJECT_UPDATED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfProject:${phase.projectId}`,
      metadata: { phaseDeleted: phase.name },
    });
    revalidatePath(`/silverfang/projects/${phase.projectId}`);
    return { ok: true, message: `Deleted ${phase.name}.` };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/**
 * Record that the deposit has been invoiced, freezing the amount as at today's
 * total. Deliberately a manual step: nothing here pushes an invoice on its own,
 * and this only records what a human did.
 */
export async function markDepositInvoicedAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("projects:manage");
  try {
    const id = z.string().min(1).parse(formValue(formData, "projectId"));
    const project = await prisma.sfProject.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        billingType: true,
        fixedFeeAmount: true,
        budgetAmount: true,
        depositPercent: true,
        depositAmount: true,
        depositInvoicedAt: true,
      },
    });
    if (!project) return { ok: false, message: "That project no longer exists." };
    if (project.depositInvoicedAt) {
      return { ok: false, message: "That deposit is already marked as invoiced." };
    }
    if (project.depositPercent == null) {
      return { ok: false, message: "This project has no deposit configured." };
    }

    const total = projectTotal({
      billingType: project.billingType,
      fixedFeeAmount: project.fixedFeeAmount != null ? Number(project.fixedFeeAmount) : null,
      budgetAmount: project.budgetAmount != null ? Number(project.budgetAmount) : null,
    });
    const amount = depositAmountFor(total, Number(project.depositPercent));
    if (amount == null) {
      return {
        ok: false,
        message: "There is no total to take the deposit from, so there is no amount to record.",
      };
    }

    const saved = await prisma.sfProject.update({
      where: { id },
      data: { depositAmount: amount, depositInvoicedAt: new Date() },
    });
    await recordChanges({
      entity: "SfProject",
      entityId: id,
      entityLabel: project.name,
      actor: { id: user.id, email: user.email },
      before: project as unknown as Record<string, unknown>,
      after: saved as unknown as Record<string, unknown>,
      fields: ["depositAmount", "depositInvoicedAt"],
    });
    await audit({
      action: "PROJECT_UPDATED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfProject:${id}`,
      metadata: { depositInvoiced: amount },
    });
    revalidatePath(`/silverfang/projects/${id}`);
    return { ok: true, message: `Deposit of ${amount} recorded as invoiced.` };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

const taskSchema = z.object({
  id: optionalId,
  projectId: z.string().min(1),
  projectPhaseId: optionalId,
  phase: z.preprocess(emptyToUndefined, z.string().max(120).optional()),
  name: z.string().trim().min(1, "Task name is required").max(200),
  status: z.enum(SfTaskStatus),
  assigneeId: optionalId,
  estimatedHours: optionalNumber,
  dueDate: optionalDate,
  sortOrder: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(9_999).optional()),
});

/** Create or update one project task. */
export async function saveProjectTaskAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("projects:manage");
  try {
    const input = taskSchema.parse({
      id: formValue(formData, "id"),
      projectId: formValue(formData, "projectId"),
      projectPhaseId: formValue(formData, "projectPhaseId"),
      phase: formValue(formData, "phase"),
      name: formValue(formData, "name"),
      status: formValue(formData, "status"),
      assigneeId: formValue(formData, "assigneeId"),
      estimatedHours: formValue(formData, "estimatedHours"),
      dueDate: formValue(formData, "dueDate"),
      sortOrder: formValue(formData, "sortOrder"),
    });

    const project = await prisma.sfProject.findUnique({
      where: { id: input.projectId },
      select: { id: true, name: true },
    });
    if (!project) return { ok: false, message: "That project no longer exists." };

    if (input.projectPhaseId) {
      const phase = await prisma.sfProjectPhase.findUnique({
        where: { id: input.projectPhaseId },
        select: { projectId: true },
      });
      if (!phase || phase.projectId !== input.projectId) {
        return { ok: false, message: "That phase does not belong to this project." };
      }
    }

    const completing = input.status === "COMPLETED";
    const data = {
      projectId: input.projectId,
      projectPhaseId: input.projectPhaseId ?? null,
      phase: input.phase ?? null,
      name: input.name,
      status: input.status,
      assigneeId: input.assigneeId ?? null,
      estimatedHours: input.estimatedHours ?? null,
      dueDate: input.dueDate ?? null,
      sortOrder: input.sortOrder ?? 0,
      // Stamped on completion and cleared when reopened, so the date always
      // reflects the current state rather than the first time it was ticked.
      completedAt: completing ? new Date() : null,
    };

    const before = input.id
      ? await prisma.sfProjectTask.findUnique({ where: { id: input.id } })
      : null;
    const saved = input.id
      ? await prisma.sfProjectTask.update({
          where: { id: input.id },
          data: {
            ...data,
            completedAt: completing ? (before?.completedAt ?? new Date()) : null,
          },
        })
      : await prisma.sfProjectTask.create({ data });

    await recordChanges({
      entity: "SfProjectTask",
      entityId: saved.id,
      entityLabel: `${project.name} — ${saved.name}`,
      actor: { id: user.id, email: user.email },
      before,
      after: saved as unknown as Record<string, unknown>,
      fields: [
        "projectPhaseId",
        "phase",
        "name",
        "status",
        "assigneeId",
        "estimatedHours",
        "dueDate",
        "sortOrder",
      ],
    });
    await audit({
      action: "PROJECT_UPDATED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfProject:${input.projectId}`,
      metadata: { taskId: saved.id, status: input.status },
    });
    revalidatePath(`/silverfang/projects/${input.projectId}`);
    return { ok: true, message: input.id ? "Task saved." : "Task added." };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Delete a task. Refused once time is logged against it. */
export async function deleteProjectTaskAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects:manage");
  const id = z.string().min(1).parse(formData.get("id"));
  const task = await prisma.sfProjectTask.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      projectId: true,
      _count: { select: { timeEntries: true, tickets: true } },
    },
  });
  if (!task) return;
  if (task._count.timeEntries > 0 || task._count.tickets > 0) return;

  await prisma.sfProjectTask.delete({ where: { id } });
  await recordChanges({
    entity: "SfProjectTask",
    entityId: id,
    entityLabel: task.name,
    actor: { id: user.id, email: user.email },
    before: task as unknown as Record<string, unknown>,
    after: null,
    fields: [],
  });
  revalidatePath(`/silverfang/projects/${task.projectId}`);
}

const templateSchema = z.object({
  id: optionalId,
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.preprocess(emptyToUndefined, z.string().max(20_000).optional()),
  active: z.coerce.boolean(),
  /** One task per line: "Phase | Name | estimatedHours | dueOffsetDays" */
  tasks: z.preprocess(emptyToUndefined, z.string().max(20_000).optional()),
});

/**
 * Create or update a project template. Tasks are entered as one line each —
 * `Phase | Name | hours | dayOffset` — because a template is a checklist, and a
 * per-row form for a 30-step build is worse than a textarea.
 */
export async function saveProjectTemplateAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("projects:manage");
  try {
    const input = templateSchema.parse({
      id: formValue(formData, "id"),
      name: formValue(formData, "name"),
      description: formValue(formData, "description"),
      active: formData.get("active") === "on",
      tasks: formValue(formData, "tasks"),
    });

    const parsed = parseTemplateTasks(input.tasks ?? "");
    if (parsed.errors.length > 0) {
      return { ok: false, message: parsed.errors.join(" ") };
    }

    const data = {
      name: input.name,
      description: input.description ?? null,
      active: input.active,
    };
    const template = input.id
      ? await prisma.sfProjectTemplate.update({ where: { id: input.id }, data })
      : await prisma.sfProjectTemplate.create({ data });

    // Replace the task list wholesale: it is a definition, not a ledger, and a
    // partial merge would leave rows nobody asked for.
    await prisma.$transaction([
      prisma.sfProjectTemplateTask.deleteMany({ where: { templateId: template.id } }),
      ...(parsed.tasks.length > 0
        ? [
            prisma.sfProjectTemplateTask.createMany({
              data: parsed.tasks.map((t, i) => ({
                templateId: template.id,
                phase: t.phase,
                name: t.name,
                estimatedHours: t.estimatedHours,
                dueOffsetDays: t.dueOffsetDays,
                sortOrder: i * 10,
              })),
            }),
          ]
        : []),
    ]);

    await audit({
      action: "SILVERFANG_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: `silverfang:projectTemplate:${template.id}`,
      metadata: { name: template.name, tasks: parsed.tasks.length, active: input.active },
    });
    revalidatePath("/silverfang/projects/templates");
    return {
      ok: true,
      message: `Template saved with ${parsed.tasks.length} task(s).`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
