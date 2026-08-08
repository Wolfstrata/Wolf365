/**
 * What a new ticket can work out for itself.
 *
 * Every field a tech has to fill in by hand is a field they can get wrong, and
 * most of them are already determined by where they clicked "New ticket" from. A
 * ticket raised on a project phase belongs to that project, that project's
 * agreement and that phase; a ticket raised on a client belongs to that client's
 * primary contact and their managed agreement. None of that is a guess, so none
 * of it should be make-work.
 *
 * Pure and tested, because the failure mode is silent: a ticket filed against
 * the wrong agreement bills the wrong client at the wrong rate, and nobody sees
 * a form validation error telling them so.
 *
 * The rule throughout: **fill in what is determined, leave what is a guess.**
 * A single candidate is determined. A choice between several is not, and is left
 * blank so the person raising the ticket makes it deliberately.
 */

import { boardNameFor } from "./boards";

/**
 * The contact the ticket is for.
 *
 * Requested wins (they came from that contact's page). Otherwise the client's
 * primary contact, and failing that the only contact they have. With several
 * non-primary contacts and no primary, nothing is chosen — picking whoever sorts
 * first would put a stranger's name on the ticket, and worse, on any mail it
 * later sends.
 */
export function pickContact(
  contacts: { id: string; isPrimary?: boolean }[],
  requestedId?: string | null,
): string | undefined {
  const requested = requestedId ? contacts.find((c) => c.id === requestedId) : undefined;
  if (requested) return requested.id;
  const primary = contacts.find((c) => c.isPrimary);
  if (primary) return primary.id;
  return contacts.length === 1 ? contacts[0]!.id : undefined;
}

/**
 * The project phase the work sits in.
 *
 * Requested wins. Otherwise the only phase, when there is one — a single-phase
 * project has no ambiguity to resolve, and leaving it blank there just means the
 * hours land on the project instead of the stage they were done in.
 */
export function pickPhase(
  phases: { id: string }[],
  requestedId?: string | null,
): string | undefined {
  const requested = requestedId ? phases.find((p) => p.id === requestedId) : undefined;
  if (requested) return requested.id;
  return phases.length === 1 ? phases[0]!.id : undefined;
}

/**
 * The agreement the ticket's time bills against.
 *
 * Precedence, most specific first:
 *  1. explicitly requested — arriving from an agreement page says which one;
 *  2. the parent project's — a project ticket bills the way its project does,
 *     which is more specific than anything the client-level default knows;
 *  3. the client's default (their configured one, else managed services).
 *
 * Every candidate is validated against the agreements actually selectable for
 * this client, so a stale link can never file a ticket against another client's
 * agreement, and the form can never show a value its picker does not contain.
 */
export function pickAgreement(
  available: { id: string }[],
  candidates: {
    requestedId?: string | null;
    projectAgreementId?: string | null;
    clientDefaultId?: string | null;
  },
): string | undefined {
  const ordered = [
    candidates.requestedId,
    candidates.projectAgreementId,
    candidates.clientDefaultId,
  ];
  for (const id of ordered) {
    if (id && available.some((a) => a.id === id)) return id;
  }
  return undefined;
}

/**
 * Who the ticket starts out assigned to.
 *
 * A project ticket goes to the project manager: they own the work, and an
 * unassigned project ticket is one nobody is watching. Off a project, the
 * client's account manager is used — but only when it resolves to exactly one
 * enabled user.
 *
 * `accountManager` is free text on the client profile and account managers are
 * often not techs at all, so it is matched on a full name or email, never on a
 * fragment, and an ambiguous match assigns nobody. Guessing here would quietly
 * put another person's name on the ticket and drop it into their queue.
 */
export function pickAssignees(input: {
  requestedIds?: string[];
  projectManagerId?: string | null;
  accountManager?: string | null;
  users: { id: string; name?: string | null; email: string }[];
}): string[] {
  const known = new Set(input.users.map((u) => u.id));
  const requested = (input.requestedIds ?? []).filter((id) => known.has(id));
  if (requested.length > 0) return requested;

  if (input.projectManagerId && known.has(input.projectManagerId)) {
    return [input.projectManagerId];
  }

  const name = (input.accountManager ?? "").trim().toLowerCase();
  if (!name) return [];
  const matches = input.users.filter(
    (u) => (u.name ?? "").trim().toLowerCase() === name || u.email.trim().toLowerCase() === name,
  );
  return matches.length === 1 ? [matches[0]!.id] : [];
}

/**
 * The client, when it was not asked for directly.
 *
 * A link that names a project names its client implicitly. Resolving it here is
 * what lets "New ticket" from a project work at all when the button forgets to
 * pass `?client=`, rather than dropping the tech on an empty form and making
 * them re-pick the client they were already looking at.
 */
export function resolveClientId(input: {
  requestedClientId?: string | null;
  clients: { id: string }[];
  projects: { id: string; clientId: string }[];
  requestedProjectId?: string | null;
}): string | undefined {
  const requested = input.requestedClientId
    ? input.clients.find((c) => c.id === input.requestedClientId)?.id
    : undefined;
  if (requested) return requested;
  const project = input.requestedProjectId
    ? input.projects.find((p) => p.id === input.requestedProjectId)
    : undefined;
  if (!project) return undefined;
  // Still validated: a project whose client is archived is not selectable, and a
  // form pointed at an unselectable client would refuse to save.
  return input.clients.some((c) => c.id === project.clientId) ? project.clientId : undefined;
}

/** A client's SilverFang defaults, resolved once and reused. */
export interface ClientTicketDefaults {
  defaultBoardId?: string | null;
  /** The client's default agreement, already picked — see `default-agreement.ts`. */
  defaultAgreementId?: string | null;
  accountManager?: string | null;
}

export interface TicketContextInput {
  boards: { id: string; name: string }[];
  agreements: { id: string; type: string }[];
  contacts: { id: string; isPrimary?: boolean }[];
  users: { id: string; name?: string | null; email: string }[];
  clientDefaults?: ClientTicketDefaults | null;
  /** The parent project, when the ticket is being raised on one. */
  project?: {
    agreementId?: string | null;
    managerId?: string | null;
    phases: { id: string }[];
  } | null;
  requested?: {
    agreementId?: string | null;
    contactId?: string | null;
    projectPhaseId?: string | null;
    assigneeIds?: string[];
  };
}

export interface TicketContext {
  contactId: string;
  agreementId: string;
  boardId: string;
  projectPhaseId: string;
  assigneeIds: string[];
}

/**
 * Everything a ticket derives from the client (and project) it is being raised
 * against, in one place.
 *
 * Deliberately shared between the server, which fills the form on first render,
 * and the form itself, which re-derives when someone changes the client or
 * project. Splitting them meant switching client left the old client's contact
 * and agreement sitting in the form — the exact make-work this is here to
 * remove — and any drift between the two would show up as a form that fills in
 * one thing on load and a different thing on edit.
 *
 * Returns strings rather than optionals because the form's inputs are strings;
 * "" is "nothing chosen".
 */
export function deriveTicketContext(input: TicketContextInput): TicketContext {
  const requested = input.requested ?? {};
  const project = input.project ?? null;

  const agreementId = pickAgreement(input.agreements, {
    requestedId: requested.agreementId,
    projectAgreementId: project?.agreementId,
    clientDefaultId: input.clientDefaults?.defaultAgreementId,
  });

  // The board follows the kind of work: a project ticket opens on Projects, work
  // under a managed agreement on MSA, everything else on the catch-all.
  const routedName = boardNameFor({
    hasProject: Boolean(project),
    agreementType: agreementId
      ? (input.agreements.find((a) => a.id === agreementId)?.type ?? null)
      : null,
  });
  const routedBoardId = input.boards.find((b) => b.name === routedName)?.id;

  // Only honour a configured default that is still selectable — a board can be
  // deactivated after the profile was saved.
  const clientDefaultBoardId = input.boards.find(
    (b) => b.id === input.clientDefaults?.defaultBoardId,
  )?.id;

  // A project ticket goes on Projects even when the client has a default board.
  // That default is about where this client's ad-hoc work lands; it was not a
  // decision to file their project work outside the project queue, and honouring
  // it there is how a project's tickets end up scattered.
  const boardId = project
    ? (routedBoardId ?? clientDefaultBoardId ?? input.boards[0]?.id)
    : (clientDefaultBoardId ?? routedBoardId ?? input.boards[0]?.id);

  return {
    contactId: pickContact(input.contacts, requested.contactId) ?? "",
    agreementId: agreementId ?? "",
    boardId: boardId ?? "",
    projectPhaseId: project ? (pickPhase(project.phases, requested.projectPhaseId) ?? "") : "",
    assigneeIds: pickAssignees({
      requestedIds: requested.assigneeIds,
      projectManagerId: project?.managerId,
      accountManager: input.clientDefaults?.accountManager,
      users: input.users,
    }),
  };
}
