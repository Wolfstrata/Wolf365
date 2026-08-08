import "server-only";
import { prisma } from "@/lib/db";
import { contactRead, textRead } from "@/lib/silverfang/pii";
import { deriveTicketContext, resolveClientId } from "@/lib/silverfang/ticket-defaults";
import { pickDefaultAgreement } from "@/lib/silverfang/default-agreement";
import type {
  TicketFormOptions,
  TicketFormValues,
} from "@/app/(app)/silverfang/ticket-form";

/**
 * Form-shape mappers for the ticket form: everything is a string so the form is
 * uncontrolled-friendly and the server action does the parsing/validation.
 */

export function blankTicketValues(
  defaults: {
    boardId?: string;
    clientId?: string;
    contactId?: string;
    agreementId?: string;
    projectId?: string;
    projectPhaseId?: string;
    assigneeIds?: string[];
  } = {},
): TicketFormValues {
  return {
    clientId: defaults.clientId ?? "",
    contactId: defaults.contactId ?? "",
    boardId: defaults.boardId ?? "",
    statusId: "",
    priority: "P3",
    source: "PORTAL",
    summary: "",
    description: "",
    assigneeIds: defaults.assigneeIds ?? [],
    agreementId: defaults.agreementId ?? "",
    projectId: defaults.projectId ?? "",
    projectPhaseId: defaults.projectPhaseId ?? "",
    type: "",
    subtype: "",
    estimatedHours: "",
  };
}

/**
 * Starting values for a brand-new ticket: everything the context already
 * determines, filled in.
 *
 * `requestedClientId` comes from the caller (the "New ticket" button on a client
 * page passes `?client=`), but a link that names a project names its client too,
 * so either is enough. From the client, the SilverFang profile supplies the
 * default board and agreement; from the project, its own agreement, manager and
 * — when it has only one — its phase. See `ticket-defaults.ts` for what is
 * filled and what is deliberately left to the person raising the ticket.
 */
export async function newTicketValues(
  options: TicketFormOptions,
  requestedClientId?: string,
  requested: {
    projectId?: string;
    projectPhaseId?: string;
    agreementId?: string;
    contactId?: string;
    assigneeIds?: string[];
  } = {},
): Promise<TicketFormValues> {
  const firstBoardId = options.boards[0]?.id;
  const allProjects = Object.values(options.projectsByClient).flat();
  const clientId = resolveClientId({
    requestedClientId,
    clients: options.clients,
    projects: allProjects,
    requestedProjectId: requested.projectId,
  });
  if (!clientId) return blankTicketValues({ boardId: firstBoardId });

  // A project (and phase) can be requested by the "New project ticket" button on
  // a phase — honoured only when it really belongs to this client.
  const project = (options.projectsByClient[clientId] ?? []).find(
    (p) => p.id === requested.projectId,
  );

  // Exactly what the form re-runs when someone changes the client here, so the
  // first render and every later edit fill in the same things.
  const derived = deriveTicketContext({
    boards: options.boards,
    agreements: options.agreementsByClient[clientId] ?? [],
    contacts: options.contactsByClient[clientId] ?? [],
    users: options.users,
    clientDefaults: options.clientDefaults[clientId],
    project,
    requested,
  });

  return blankTicketValues({
    clientId,
    boardId: derived.boardId || firstBoardId,
    agreementId: derived.agreementId,
    contactId: derived.contactId,
    assigneeIds: derived.assigneeIds,
    projectId: project?.id,
    projectPhaseId: derived.projectPhaseId,
  });
}

/** Options for the ticket form's selects, including per-client dependent lists. */
export async function getTicketFormData(): Promise<TicketFormOptions> {
  const [boards, clients, users, contacts, agreements, projects, profiles] = await Promise.all([
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
    prisma.sfContact.findMany({
      where: { active: true },
      orderBy: [{ isPrimary: "desc" }, { firstName: "asc" }],
      select: {
        id: true,
        clientId: true,
        firstName: true,
        lastName: true,
        email: true,
        isPrimary: true,
      },
    }),
    prisma.sfAgreement.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      // Dates come along so the default-agreement pick below sees the same term
      // window the server-side picker does.
      select: {
        id: true,
        clientId: true,
        name: true,
        type: true,
        startDate: true,
        endDate: true,
      },
    }),
    // Only live projects: a ticket cannot usefully be raised against one that is
    // finished or cancelled.
    prisma.sfProject.findMany({
      where: { status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        clientId: true,
        name: true,
        // Inherited by a ticket raised on the project: it bills the way the
        // project does and starts with the project's owner watching it.
        agreementId: true,
        managerId: true,
        phases: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true, name: true },
        },
      },
    }),
    prisma.sfClientProfile.findMany({
      select: {
        clientId: true,
        defaultBoardId: true,
        defaultAgreementId: true,
        accountManager: true,
      },
    }),
  ]);

  const contactsByClient: TicketFormOptions["contactsByClient"] = {};
  for (const raw of contacts) {
    // The address is encrypted at rest; the picker shows it, so decrypt here.
    const c = contactRead(raw);
    const label =
      [c.firstName, c.lastName].filter(Boolean).join(" ") + (c.email ? ` <${c.email}>` : "");
    (contactsByClient[c.clientId] ??= []).push({
      id: c.id,
      name: label,
      isPrimary: raw.isPrimary,
    });
  }

  const agreementsByClient: TicketFormOptions["agreementsByClient"] = {};
  for (const a of agreements) {
    (agreementsByClient[a.clientId] ??= []).push({ id: a.id, name: a.name, type: a.type });
  }

  const projectsByClient: TicketFormOptions["projectsByClient"] = {};
  for (const p of projects) {
    (projectsByClient[p.clientId] ??= []).push({
      id: p.id,
      clientId: p.clientId,
      name: p.name,
      agreementId: p.agreementId,
      managerId: p.managerId,
      phases: p.phases,
    });
  }

  // Resolved once, here, rather than queried per client: the form re-derives
  // its defaults in the browser when the client changes, and it can only do
  // that if the answer travelled with the options. `pickDefaultAgreement` is the
  // same function the server-side default uses, so the two cannot drift.
  const agreementsForPick: Record<
    string,
    { id: string; type: string; startDate: Date | null; endDate: Date | null }[]
  > = {};
  for (const a of agreements) {
    (agreementsForPick[a.clientId] ??= []).push({
      id: a.id,
      type: a.type,
      startDate: a.startDate,
      endDate: a.endDate,
    });
  }
  const profileByClient = new Map(profiles.map((p) => [p.clientId, p]));
  const clientDefaults: TicketFormOptions["clientDefaults"] = {};
  for (const client of clients) {
    const profile = profileByClient.get(client.id);
    const pick = pickDefaultAgreement(agreementsForPick[client.id] ?? [], {
      profileDefaultId: profile?.defaultAgreementId,
    });
    clientDefaults[client.id] = {
      defaultBoardId: profile?.defaultBoardId ?? null,
      defaultAgreementId: pick?.id ?? null,
      accountManager: profile?.accountManager ?? null,
    };
  }

  return {
    boards: boards.map((b) => ({
      id: b.id,
      name: b.name,
      statuses: b.statuses.map((s) => ({ id: s.id, name: s.name })),
    })),
    clients,
    users,
    contactsByClient,
    agreementsByClient,
    projectsByClient,
    clientDefaults,
  };
}

/** Map a stored ticket into form values. */
export async function ticketToFormValues(id: string): Promise<TicketFormValues | null> {
  const t = await prisma.sfTicket.findUnique({
    where: { id },
    include: { assignees: { orderBy: { createdAt: "asc" }, select: { userId: true } } },
  });
  if (!t) return null;
  return {
    id: t.id,
    clientId: t.clientId,
    contactId: t.contactId ?? "",
    boardId: t.boardId,
    statusId: t.statusId,
    priority: t.priority,
    source: t.source,
    summary: t.summary,
    description: textRead(t.description) ?? "",
    // Primary first, so the chips read in the order that matters.
    assigneeIds: t.assigneeId
      ? [t.assigneeId, ...t.assignees.filter((a) => a.userId !== t.assigneeId).map((a) => a.userId)]
      : t.assignees.map((a) => a.userId),
    agreementId: t.agreementId ?? "",
    projectId: t.projectId ?? "",
    projectPhaseId: t.projectPhaseId ?? "",
    type: t.type ?? "",
    subtype: t.subtype ?? "",
    estimatedHours: t.estimatedHours != null ? String(Number(t.estimatedHours)) : "",
  };
}
