/**
 * Which board a ticket belongs on.
 *
 * Boards are organised by the *kind of work*, not by who does it. A per-person
 * board turns a queue into an inbox — nobody else picks it up, and the work is
 * invisible until that person looks. Three kinds, in the order they are decided:
 *
 *   PROJECTS  work under a project — it has a plan, phases and a budget
 *   MSA       work covered by an agreement: managed services, NOC, prepaid block
 *   SERVICE   everything else: ad-hoc requests with no agreement behind them
 *
 * Project wins over agreement deliberately. A managed-services client's project
 * work is still project work: it is scoped, phased and tracked against a project
 * total, and burying it in the MSA queue is how a project silently loses its hours.
 */

export type BoardKey = "MSA" | "PROJECTS" | "SERVICE";

/** Agreement types whose work is covered by the agreement rather than billed ad hoc. */
const MSA_AGREEMENT_TYPES = new Set(["MANAGED_SERVICES", "MANAGED_NOC", "BLOCK_TIME"]);

export interface BoardRoutingInput {
  /** The ticket belongs to a project (or one of its phases). */
  hasProject: boolean;
  /** The agreement's type, when the ticket is against one. */
  agreementType?: string | null;
}

export function boardKeyFor(input: BoardRoutingInput): BoardKey {
  if (input.hasProject) return "PROJECTS";
  if (input.agreementType && MSA_AGREEMENT_TYPES.has(input.agreementType)) return "MSA";
  return "SERVICE";
}

export interface BoardSpec {
  key: BoardKey;
  name: string;
  description: string;
  sortOrder: number;
}

/**
 * The three boards, seeded by setup.
 *
 * SERVICE keeps the name "Service Desk" on purpose: it is the board that already
 * exists on every install, and renaming it would strand every ticket ever filed on
 * a board nobody recognises. The other two are added alongside it.
 */
export const BOARD_SPECS: BoardSpec[] = [
  {
    key: "MSA",
    name: "MSA",
    description:
      "Work covered by an agreement — managed services, NOC and prepaid block time.",
    sortOrder: 10,
  },
  {
    key: "PROJECTS",
    name: "Projects",
    description: "Tickets belonging to a project phase, tracked against the project's hours.",
    sortOrder: 20,
  },
  {
    key: "SERVICE",
    name: "Service Desk",
    description: "Ad-hoc requests with no agreement or project behind them.",
    sortOrder: 30,
  },
];

export function boardSpecFor(key: BoardKey): BoardSpec {
  const spec = BOARD_SPECS.find((b) => b.key === key);
  if (!spec) throw new Error(`No board spec for ${key}`);
  return spec;
}

/** The board name a routing decision maps to. */
export function boardNameFor(input: BoardRoutingInput): string {
  return boardSpecFor(boardKeyFor(input)).name;
}
