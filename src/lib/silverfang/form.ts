import "server-only";
import { prisma } from "@/lib/db";
import { contactRead, textRead } from "@/lib/silverfang/pii";
import { boardNameFor } from "@/lib/silverfang/boards";
import { defaultAgreementFor } from "@/lib/silverfang/service";
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
    assigneeIds: [],
    agreementId: defaults.agreementId ?? "",
    projectId: defaults.projectId ?? "",
    projectPhaseId: defaults.projectPhaseId ?? "",
    type: "",
    subtype: "",
    estimatedHours: "",
  };
}

/**
 * Starting values for a brand-new ticket. `requestedClientId` comes from the
 * caller (the "New ticket" button on a client page passes `?client=`); when it
 * names a real client, that client's SilverFang profile supplies the default
 * board and agreement.
 */
export async function newTicketValues(
  options: TicketFormOptions,
  requestedClientId?: string,
  requested: {
    projectId?: string;
    projectPhaseId?: string;
    agreementId?: string;
    contactId?: string;
  } = {},
): Promise<TicketFormValues> {
  const firstBoardId = options.boards[0]?.id;
  const clientId =
    requestedClientId && options.clients.some((c) => c.id === requestedClientId)
      ? requestedClientId
      : "";
  if (!clientId) return blankTicketValues({ boardId: firstBoardId });

  const [profile, pick] = await Promise.all([
    prisma.sfClientProfile.findUnique({
      where: { clientId },
      select: { defaultBoardId: true },
    }),
    // Honours the client's configured default first and falls back to their
    // managed-services (then managed-NOC) agreement, so a managed client's ticket
    // arrives already pointed at the agreement its time belongs on. Never picks
    // block time — see `default-agreement.ts`.
    defaultAgreementFor(clientId),
  ]);

  const clientAgreements = options.agreementsByClient[clientId] ?? [];
  // An explicitly requested agreement wins — arriving from an agreement page means
  // the ticket is for that agreement, which is more specific than the default.
  // Validated against this client's list, so a stale link cannot file a ticket
  // against another client's agreement.
  const requestedAgreementId = requested.agreementId
    ? clientAgreements.find((a) => a.id === requested.agreementId)?.id
    : undefined;
  // Only offer the default if the form can actually show it selected; the picker is
  // fed by `agreementsByClient`, and a value not in the list would render as blank.
  const agreementId =
    requestedAgreementId ??
    (pick && clientAgreements.some((a) => a.id === pick.id) ? pick.id : undefined);

  // Same rule for the contact: honoured only when they belong to this client.
  const contactId = requested.contactId
    ? (options.contactsByClient[clientId] ?? []).find((c) => c.id === requested.contactId)?.id
    : undefined;

  // A project (and phase) can be requested by the "New project ticket" button on
  // a phase — honoured only when it really belongs to this client.
  const clientProjects = options.projectsByClient[clientId] ?? [];
  const project = clientProjects.find((p) => p.id === requested.projectId);
  const phase = project?.phases.find((p) => p.id === requested.projectPhaseId);

  // The board follows the kind of work: a project ticket opens on Projects, work
  // under a managed agreement on MSA, everything else on the catch-all. A client's
  // explicitly configured default board still wins, since somebody chose it.
  const agreementType = agreementId
    ? clientAgreements.find((a) => a.id === agreementId)?.type
    : undefined;
  const routedName = boardNameFor({
    hasProject: Boolean(project),
    agreementType: agreementType ?? null,
  });
  const routedBoardId = options.boards.find((b) => b.name === routedName)?.id;

  // Only honour defaults that are still selectable — a board can be deactivated
  // or an agreement expire after the profile was saved.
  const clientDefaultBoardId =
    profile?.defaultBoardId && options.boards.some((b) => b.id === profile.defaultBoardId)
      ? profile.defaultBoardId
      : undefined;

  // A project ticket goes on Projects even when the client has a default board.
  // That default is about where this client's ad-hoc work lands; it was not a
  // decision to file their project work outside the project queue, and honouring
  // it there is how a project's tickets end up scattered.
  const boardId = project
    ? (routedBoardId ?? clientDefaultBoardId ?? firstBoardId)
    : (clientDefaultBoardId ?? routedBoardId ?? firstBoardId);

  return blankTicketValues({
    clientId,
    boardId,
    agreementId,
    contactId,
    projectId: project?.id,
    projectPhaseId: phase?.id,
  });
}

/** Options for the ticket form's selects, including per-client dependent lists. */
export async function getTicketFormData(): Promise<TicketFormOptions> {
  const [boards, clients, users, contacts, agreements, projects] = await Promise.all([
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
      select: { id: true, clientId: true, firstName: true, lastName: true, email: true },
    }),
    prisma.sfAgreement.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, clientId: true, name: true, type: true },
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
        phases: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true, name: true },
        },
      },
    }),
  ]);

  const contactsByClient: TicketFormOptions["contactsByClient"] = {};
  for (const raw of contacts) {
    // The address is encrypted at rest; the picker shows it, so decrypt here.
    const c = contactRead(raw);
    const label =
      [c.firstName, c.lastName].filter(Boolean).join(" ") + (c.email ? ` <${c.email}>` : "");
    (contactsByClient[c.clientId] ??= []).push({ id: c.id, name: label });
  }

  const agreementsByClient: TicketFormOptions["agreementsByClient"] = {};
  for (const a of agreements) {
    (agreementsByClient[a.clientId] ??= []).push({ id: a.id, name: a.name, type: a.type });
  }

  const projectsByClient: TicketFormOptions["projectsByClient"] = {};
  for (const p of projects) {
    (projectsByClient[p.clientId] ??= []).push({
      id: p.id,
      name: p.name,
      phases: p.phases,
    });
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
