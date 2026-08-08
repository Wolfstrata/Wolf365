import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { boardNameFor } from "@/lib/silverfang/boards";
import { nextTicketNumber, slaDueDatesFor } from "@/lib/silverfang/service";
import { projectToTemplateDraft, type TemplateDraft } from "@/lib/silverfang/project-templates";

/**
 * Capturing a project as a template, and stamping a template onto a project.
 *
 * Two directions of the same mapping, kept together so they cannot drift: if
 * capture kept a field that materialize ignored, the template would look right in
 * the editor and generate projects missing half of it.
 */

// ---------------------------------------------------------------------------
// Capture: project → template
// ---------------------------------------------------------------------------

export interface CaptureResult {
  templateId: string;
  templateName: string;
  phases: number;
  tickets: number;
}

/**
 * Save an existing project's shape as a reusable template.
 *
 * Ticket **descriptions are deliberately not copied**. A real project's
 * ticket body is a specific client's problem, in their words; carrying it into a
 * template would put one client's detail onto every project generated from it
 * afterwards. Summaries, hours and structure are the reusable part.
 *
 * Closed and cancelled tickets are skipped: the template should stamp out the
 * work, not the history of what went wrong last time.
 */
export async function captureProjectAsTemplate(input: {
  projectId: string;
  name: string;
  description?: string | null;
  includeTickets: boolean;
}): Promise<CaptureResult | { error: string }> {
  const project = await prisma.sfProject.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      name: true,
      startDate: true,
      billingType: true,
      contractedHours: true,
      estimatedHours: true,
      fixedFeeAmount: true,
      billingIntervalDays: true,
      depositPercent: true,
      phases: { select: { name: true, hours: true, sortOrder: true } },
      // Selected unconditionally and filtered below: a conditional `select`
      // defeats Prisma's type inference and widens the row to the whole model.
      tickets: {
        where: { closedAt: null },
        orderBy: { number: "asc" },
        select: {
          summary: true,
          priority: true,
          estimatedHours: true,
          projectPhase: { select: { name: true } },
        },
      },
    },
  });
  if (!project) return { error: "That project no longer exists." };

  const clash = await prisma.sfProjectTemplate.findUnique({
    where: { name: input.name },
    select: { id: true },
  });
  if (clash) {
    return {
      error: `There is already a template called "${input.name}". Give this one a different name, or edit the existing one.`,
    };
  }

  const draft = projectToTemplateDraft({
    startDate: project.startDate,
    billingType: project.billingType,
    contractedHours: num(project.contractedHours),
    estimatedHours: num(project.estimatedHours),
    fixedFeeAmount: num(project.fixedFeeAmount),
    billingIntervalDays: project.billingIntervalDays,
    depositPercent: num(project.depositPercent),
    phases: project.phases.map((p) => ({
      name: p.name,
      hours: num(p.hours),
      sortOrder: p.sortOrder,
    })),
    tickets: (input.includeTickets ? project.tickets : []).map((t) => ({
      summary: t.summary,
      phaseName: t.projectPhase?.name ?? null,
      priority: t.priority,
      estimatedHours: num(t.estimatedHours),
    })),
  });

  const template = await writeTemplate({
    name: input.name,
    description: input.description ?? `Captured from “${project.name}”.`,
    active: true,
    sourceProjectId: project.id,
    draft,
  });

  return {
    templateId: template.id,
    templateName: input.name,
    phases: draft.phases.length,
    tickets: draft.tickets.length,
  };
}

/**
 * Write a template's phases and tickets, replacing whatever was there.
 *
 * Wholesale replacement, not a merge: a template is a definition, and a partial
 * merge leaves rows nobody asked for. Phases are created first so tickets can
 * be attached to them by name — the id is what makes the attachment
 * survive a later rename, which the free-text `phase` column never did.
 */
export async function writeTemplate(input: {
  id?: string;
  name: string;
  description?: string | null;
  active: boolean;
  sourceProjectId?: string | null;
  draft: TemplateDraft;
}): Promise<{ id: string }> {
  const { draft } = input;
  const shapeData = {
    name: input.name,
    description: input.description ?? null,
    active: input.active,
    billingType: draft.shape.billingType as Prisma.SfProjectTemplateCreateInput["billingType"],
    contractedHours: draft.shape.contractedHours,
    estimatedHours: draft.shape.estimatedHours,
    fixedFeeAmount: draft.shape.fixedFeeAmount,
    billingIntervalDays: draft.shape.billingIntervalDays,
    depositPercent: draft.shape.depositPercent,
  };

  return prisma.$transaction(async (tx) => {
    const template = input.id
      ? await tx.sfProjectTemplate.update({
          where: { id: input.id },
          data: {
            ...shapeData,
            ...(input.sourceProjectId ? { sourceProjectId: input.sourceProjectId } : {}),
          },
        })
      : await tx.sfProjectTemplate.create({
          data: { ...shapeData, sourceProjectId: input.sourceProjectId ?? null },
        });

    // Children first, phases last: deleting a phase would null the templatePhaseId
    // on rows we are about to delete anyway, and doing it in this order keeps the
    // intermediate state consistent if the transaction is inspected mid-flight.
    await tx.sfProjectTemplateTicket.deleteMany({ where: { templateId: template.id } });
    await tx.sfProjectTemplatePhase.deleteMany({ where: { templateId: template.id } });

    const phaseIds = new Map<string, string>();
    for (const [i, phase] of draft.phases.entries()) {
      const row = await tx.sfProjectTemplatePhase.create({
        data: {
          templateId: template.id,
          name: phase.name,
          hours: phase.hours,
          sortOrder: i * 10,
        },
        select: { id: true },
      });
      phaseIds.set(phase.name.toLowerCase(), row.id);
    }

    if (draft.tickets.length > 0) {
      await tx.sfProjectTemplateTicket.createMany({
        data: draft.tickets.map((t, i) => ({
          templateId: template.id,
          templatePhaseId: t.phase ? (phaseIds.get(t.phase.toLowerCase()) ?? null) : null,
          summary: t.summary,
          priority: t.priority,
          estimatedHours: t.estimatedHours,
          sortOrder: i * 10,
        })),
      });
    }

    return { id: template.id };
  });
}

// ---------------------------------------------------------------------------
// Materialize: template → project
// ---------------------------------------------------------------------------

export interface MaterializeResult {
  phases: number;
  tickets: number;
  /** Said out loud rather than silently skipped. */
  ticketsSkipped: string | null;
}

/**
 * Stamp a template's phases and tickets onto a freshly created project.
 *
 * Tickets need a board, a status and an SLA, none of which a template can carry —
 * they are configuration, not shape. When SilverFang has no usable board the
 * phases are still created and the ticket skip is reported, because a
 * project with its structure is worth more than an all-or-nothing failure.
 */
export async function materializeTemplate(
  input: {
    projectId: string;
    templateId: string;
    clientId: string;
    /** Offsets resolve against this — the project start, else today. */
    baseDate: Date;
  },
  actor: { id: string; email: string },
): Promise<MaterializeResult> {
  const template = await prisma.sfProjectTemplate.findUnique({
    where: { id: input.templateId },
    include: {
      phases: { orderBy: { sortOrder: "asc" } },
      tickets: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!template) return { phases: 0, tickets: 0, ticketsSkipped: null };

  // Phase name → new project-phase id, so tickets land in the right one.
  const phaseIds = new Map<string, string>();
  for (const [i, phase] of template.phases.entries()) {
    const row = await prisma.sfProjectPhase.create({
      data: {
        projectId: input.projectId,
        name: phase.name,
        hours: phase.hours,
        notes: phase.notes,
        sortOrder: i * 10,
      },
      select: { id: true },
    });
    phaseIds.set(phase.name.toLowerCase(), row.id);
  }

  let ticketsCreated = 0;
  let ticketsSkipped: string | null = null;
  if (template.tickets.length > 0) {
    const board = await projectBoard();
    if (!board) {
      ticketsSkipped =
        `${template.tickets.length} template ticket(s) were not created: no active board ` +
        `with statuses exists. Run SilverFang Setup, then add them from the project.`;
    } else {
      const status = board.statuses.find((s) => s.isDefault) ?? board.statuses[0]!;
      for (const t of template.tickets) {
        const sla = await slaDueDatesFor(board.slaId, t.priority, input.baseDate);
        // One at a time rather than createMany: each ticket needs the next number
        // from the counter, and createMany cannot call it.
        await prisma.$transaction(async (tx) => {
          const number = await nextTicketNumber(tx);
          await tx.sfTicket.create({
            data: {
              number,
              clientId: input.clientId,
              boardId: board.id,
              statusId: status.id,
              priority: t.priority,
              source: "PROJECT",
              summary: t.summary,
              projectId: input.projectId,
              projectPhaseId: phaseIdFor(phaseIds, t.templatePhaseId, template.phases),
              estimatedHours: t.estimatedHours,
              slaId: board.slaId,
              responseDueAt: sla.responseDueAt,
              resolutionDueAt: sla.resolutionDueAt,
              openedAt: input.baseDate,
              createdById: actor.id,
              createdByEmail: actor.email,
            },
          });
        });
        ticketsCreated += 1;
      }
    }
  }

  // Phase hours come from the template. If the project's contracted total was set
  // independently, the project page surfaces the mismatch rather than one of the
  // two silently overwriting the other.
  return {
    phases: template.phases.length,
    tickets: ticketsCreated,
    ticketsSkipped,
  };
}

/** The project board, else the client's/any usable board. */
async function projectBoard() {
  const include = { statuses: { orderBy: { sortOrder: "asc" as const } } };
  const routed = await prisma.sfBoard.findFirst({
    where: { name: boardNameFor({ hasProject: true, agreementType: null }), active: true },
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

/**
 * The project phase a template ticket belongs in.
 *
 * Matched by name rather than by id, because the project's phases are fresh rows
 * created moments earlier — the template's phase id means nothing to them.
 */
function phaseIdFor(
  phaseIds: Map<string, string>,
  templatePhaseId: string | null,
  templatePhases: { id: string; name: string }[],
): string | null {
  if (!templatePhaseId) return null;
  const name = templatePhases.find((p) => p.id === templatePhaseId)?.name;
  return name ? (phaseIds.get(name.toLowerCase()) ?? null) : null;
}

function num(value: { toString(): string } | null | undefined): number | null {
  return value != null ? Number(value) : null;
}
