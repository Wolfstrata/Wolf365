import "server-only";
import { prisma } from "@/lib/db";
import type {
  TicketFormOptions,
  TicketFormValues,
} from "@/app/(app)/silverfang/ticket-form";

/**
 * Form-shape mappers for the ticket form: everything is a string so the form is
 * uncontrolled-friendly and the server action does the parsing/validation.
 */

export function blankTicketValues(
  defaults: { boardId?: string; clientId?: string; agreementId?: string } = {},
): TicketFormValues {
  return {
    clientId: defaults.clientId ?? "",
    contactId: "",
    boardId: defaults.boardId ?? "",
    statusId: "",
    priority: "P3",
    source: "PORTAL",
    summary: "",
    description: "",
    assigneeId: "",
    agreementId: defaults.agreementId ?? "",
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
): Promise<TicketFormValues> {
  const firstBoardId = options.boards[0]?.id;
  const clientId =
    requestedClientId && options.clients.some((c) => c.id === requestedClientId)
      ? requestedClientId
      : "";
  if (!clientId) return blankTicketValues({ boardId: firstBoardId });

  const profile = await prisma.sfClientProfile.findUnique({
    where: { clientId },
    select: { defaultBoardId: true, defaultAgreementId: true },
  });

  // Only honour defaults that are still selectable — a board can be deactivated
  // or an agreement expire after the profile was saved.
  const boardId =
    profile?.defaultBoardId && options.boards.some((b) => b.id === profile.defaultBoardId)
      ? profile.defaultBoardId
      : firstBoardId;
  const defaultAgreementId = profile?.defaultAgreementId;
  const agreementId =
    defaultAgreementId &&
    (options.agreementsByClient[clientId] ?? []).some((a) => a.id === defaultAgreementId)
      ? defaultAgreementId
      : undefined;

  return blankTicketValues({ clientId, boardId, agreementId });
}

/** Options for the ticket form's selects, including per-client dependent lists. */
export async function getTicketFormData(): Promise<TicketFormOptions> {
  const [boards, clients, users, contacts, agreements] = await Promise.all([
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
  ]);

  const contactsByClient: TicketFormOptions["contactsByClient"] = {};
  for (const c of contacts) {
    const label =
      [c.firstName, c.lastName].filter(Boolean).join(" ") + (c.email ? ` <${c.email}>` : "");
    (contactsByClient[c.clientId] ??= []).push({ id: c.id, name: label });
  }

  const agreementsByClient: TicketFormOptions["agreementsByClient"] = {};
  for (const a of agreements) {
    (agreementsByClient[a.clientId] ??= []).push({ id: a.id, name: a.name });
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
  };
}

/** Map a stored ticket into form values. */
export async function ticketToFormValues(id: string): Promise<TicketFormValues | null> {
  const t = await prisma.sfTicket.findUnique({ where: { id } });
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
    description: t.description ?? "",
    assigneeId: t.assigneeId ?? "",
    agreementId: t.agreementId ?? "",
    type: t.type ?? "",
    subtype: t.subtype ?? "",
    estimatedHours: t.estimatedHours != null ? String(Number(t.estimatedHours)) : "",
  };
}
