"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SfProjectStatus, SfTaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import { recordChanges } from "@/lib/silverfang/change-log";
import { describeChanges } from "@/lib/silverfang/changes";
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
  estimatedHours: optionalNumber,
  budgetAmount: optionalNumber,
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
  "estimatedHours",
  "budgetAmount",
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
      estimatedHours: formValue(formData, "estimatedHours"),
      budgetAmount: formValue(formData, "budgetAmount"),
    });

    if (input.startDate && input.dueDate && input.dueDate < input.startDate) {
      return { ok: false, message: "The due date cannot be before the start date." };
    }
    const client = await prisma.client.findUnique({
      where: { id: input.clientId },
      select: { id: true, name: true },
    });
    if (!client) return { ok: false, message: "That client no longer exists." };

    const data = {
      clientId: input.clientId,
      agreementId: input.agreementId ?? null,
      name: input.name,
      description: input.description ?? null,
      status: input.status,
      managerId: input.managerId ?? null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      estimatedHours: input.estimatedHours ?? null,
      budgetAmount: input.budgetAmount ?? null,
    };

    const before = input.id
      ? await prisma.sfProject.findUnique({ where: { id: input.id } })
      : null;

    let saved;
    let tasksCreated = 0;
    if (input.id) {
      saved = await prisma.sfProject.update({ where: { id: input.id }, data });
    } else {
      const template = input.templateId
        ? await prisma.sfProjectTemplate.findUnique({
            where: { id: input.templateId },
            include: { tasks: { orderBy: { sortOrder: "asc" } } },
          })
        : null;
      const base = input.startDate ?? new Date();
      saved = await prisma.sfProject.create({
        data: {
          ...data,
          templateId: template?.id ?? null,
          createdById: user.id,
          createdByEmail: user.email,
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
      metadata: { clientId: input.clientId, status: input.status, tasksCreated },
    });
    revalidatePath("/silverfang/projects");
    revalidatePath(`/silverfang/projects/${saved.id}`);
    revalidatePath(`/silverfang/clients/${input.clientId}`);
    return {
      ok: true,
      message: input.id
        ? changes.length === 0
          ? "No changes to save."
          : `Saved ${describeChanges(changes)}.`
        : tasksCreated > 0
          ? `Project created with ${tasksCreated} task(s) from the template.`
          : "Project created.",
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

const taskSchema = z.object({
  id: optionalId,
  projectId: z.string().min(1),
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

    const completing = input.status === "COMPLETED";
    const data = {
      projectId: input.projectId,
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
