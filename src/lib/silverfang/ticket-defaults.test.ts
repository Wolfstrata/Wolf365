import { describe, it, expect } from "vitest";
import {
  deriveTicketContext,
  pickAgreement,
  pickAssignees,
  pickContact,
  pickPhase,
  resolveClientId,
} from "./ticket-defaults";

describe("pickContact", () => {
  const contacts = [
    { id: "a", isPrimary: false },
    { id: "b", isPrimary: true },
    { id: "c" },
  ];

  it("honours an explicitly requested contact", () => {
    expect(pickContact(contacts, "c")).toBe("c");
  });

  it("falls back to the primary contact", () => {
    expect(pickContact(contacts)).toBe("b");
  });

  it("ignores a requested contact that is not this client's", () => {
    // Not merely dropped — it falls through to the primary, so the form is still
    // filled in rather than blanked by a stale link.
    expect(pickContact(contacts, "someone-elses")).toBe("b");
  });

  it("uses the only contact when there is exactly one", () => {
    expect(pickContact([{ id: "solo" }])).toBe("solo");
  });

  it("chooses nobody when several contacts and none is primary", () => {
    // Picking whoever sorts first would put a stranger on the ticket.
    expect(pickContact([{ id: "a" }, { id: "b" }])).toBeUndefined();
  });

  it("handles a client with no contacts", () => {
    expect(pickContact([])).toBeUndefined();
  });
});

describe("pickPhase", () => {
  it("honours the requested phase", () => {
    expect(pickPhase([{ id: "p1" }, { id: "p2" }], "p2")).toBe("p2");
  });

  it("uses the only phase of a single-phase project", () => {
    expect(pickPhase([{ id: "only" }])).toBe("only");
  });

  it("leaves it blank when the project has several phases", () => {
    expect(pickPhase([{ id: "p1" }, { id: "p2" }])).toBeUndefined();
  });

  it("ignores a phase belonging to another project", () => {
    expect(pickPhase([{ id: "p1" }, { id: "p2" }], "elsewhere")).toBeUndefined();
  });

  it("handles a project with no phases", () => {
    expect(pickPhase([], "p1")).toBeUndefined();
  });
});

describe("pickAgreement", () => {
  const available = [{ id: "managed" }, { id: "project" }, { id: "block" }];

  it("prefers an explicitly requested agreement over everything", () => {
    expect(
      pickAgreement(available, {
        requestedId: "block",
        projectAgreementId: "project",
        clientDefaultId: "managed",
      }),
    ).toBe("block");
  });

  it("prefers the project's agreement over the client default", () => {
    // A project ticket bills the way its project does.
    expect(
      pickAgreement(available, { projectAgreementId: "project", clientDefaultId: "managed" }),
    ).toBe("project");
  });

  it("falls back to the client default", () => {
    expect(pickAgreement(available, { clientDefaultId: "managed" })).toBe("managed");
  });

  it("skips a candidate the client cannot select and tries the next", () => {
    // A stale link must never file a ticket against another client's agreement.
    expect(
      pickAgreement(available, { requestedId: "other-client", clientDefaultId: "managed" }),
    ).toBe("managed");
  });

  it("chooses nothing when no candidate is selectable", () => {
    expect(pickAgreement(available, { clientDefaultId: "expired" })).toBeUndefined();
    expect(pickAgreement([], { clientDefaultId: "managed" })).toBeUndefined();
    expect(pickAgreement(available, {})).toBeUndefined();
  });
});

describe("pickAssignees", () => {
  const users = [
    { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
    { id: "u2", name: "Grace Hopper", email: "grace@example.com" },
    { id: "u3", name: "Ada Lovelace", email: "ada2@example.com" },
  ];

  it("keeps explicitly requested assignees", () => {
    expect(pickAssignees({ requestedIds: ["u2"], projectManagerId: "u1", users })).toEqual(["u2"]);
  });

  it("drops requested ids that are not enabled users", () => {
    expect(pickAssignees({ requestedIds: ["ghost"], users })).toEqual([]);
  });

  it("assigns a project ticket to the project manager", () => {
    expect(pickAssignees({ projectManagerId: "u2", users })).toEqual(["u2"]);
  });

  it("ignores a manager who is no longer an enabled user", () => {
    expect(pickAssignees({ projectManagerId: "left-the-company", users })).toEqual([]);
  });

  it("matches the account manager on a full name or email", () => {
    expect(pickAssignees({ accountManager: "Grace Hopper", users })).toEqual(["u2"]);
    expect(pickAssignees({ accountManager: "  GRACE@EXAMPLE.COM ", users })).toEqual(["u2"]);
  });

  it("assigns nobody when the account manager is ambiguous", () => {
    // Two Adas: guessing would drop the ticket into the wrong person's queue.
    expect(pickAssignees({ accountManager: "Ada Lovelace", users })).toEqual([]);
  });

  it("assigns nobody on a partial name or an account manager who is not a user", () => {
    expect(pickAssignees({ accountManager: "Grace", users })).toEqual([]);
    expect(pickAssignees({ accountManager: "Someone Else", users })).toEqual([]);
    expect(pickAssignees({ accountManager: "   ", users })).toEqual([]);
    expect(pickAssignees({ users })).toEqual([]);
  });

  it("prefers the project manager over the account manager", () => {
    expect(pickAssignees({ projectManagerId: "u1", accountManager: "Grace Hopper", users })).toEqual(
      ["u1"],
    );
  });
});

describe("resolveClientId", () => {
  const clients = [{ id: "c1" }, { id: "c2" }];
  const projects = [
    { id: "p1", clientId: "c2" },
    { id: "p2", clientId: "archived" },
  ];

  it("uses the requested client when it is selectable", () => {
    expect(resolveClientId({ requestedClientId: "c1", clients, projects })).toBe("c1");
  });

  it("derives the client from a requested project", () => {
    expect(resolveClientId({ requestedProjectId: "p1", clients, projects })).toBe("c2");
  });

  it("prefers the requested client over the project's", () => {
    expect(
      resolveClientId({ requestedClientId: "c1", requestedProjectId: "p1", clients, projects }),
    ).toBe("c1");
  });

  it("falls through to the project when the requested client is not selectable", () => {
    expect(
      resolveClientId({ requestedClientId: "gone", requestedProjectId: "p1", clients, projects }),
    ).toBe("c2");
  });

  it("refuses a project whose client is not selectable", () => {
    expect(resolveClientId({ requestedProjectId: "p2", clients, projects })).toBeUndefined();
  });

  it("chooses nothing with no context at all", () => {
    expect(resolveClientId({ clients, projects })).toBeUndefined();
    expect(resolveClientId({ requestedProjectId: "unknown", clients, projects })).toBeUndefined();
  });
});

describe("deriveTicketContext", () => {
  const boards = [
    { id: "b-msa", name: "MSA" },
    { id: "b-proj", name: "Projects" },
    { id: "b-svc", name: "Service Desk" },
  ];
  const agreements = [
    { id: "a-managed", type: "MANAGED_SERVICES" },
    { id: "a-block", type: "BLOCK_TIME" },
    { id: "a-proj", type: "PROJECT" },
  ];
  const contacts = [{ id: "c-primary", isPrimary: true }, { id: "c-other" }];
  const users = [
    { id: "u-mgr", name: "Grace Hopper", email: "grace@example.com" },
    { id: "u-am", name: "Ada Lovelace", email: "ada@example.com" },
  ];

  it("fills a plain client ticket from the client's defaults", () => {
    expect(
      deriveTicketContext({
        boards,
        agreements,
        contacts,
        users,
        clientDefaults: { defaultAgreementId: "a-managed", accountManager: "Ada Lovelace" },
      }),
    ).toEqual({
      contactId: "c-primary",
      agreementId: "a-managed",
      // A managed agreement routes to MSA.
      boardId: "b-msa",
      projectPhaseId: "",
      assigneeIds: ["u-am"],
    });
  });

  it("routes an agreement-less ticket to the catch-all board", () => {
    const ctx = deriveTicketContext({ boards, agreements, contacts, users });
    expect(ctx.agreementId).toBe("");
    expect(ctx.boardId).toBe("b-svc");
    expect(ctx.assigneeIds).toEqual([]);
  });

  it("inherits everything a project ticket can take from its project", () => {
    expect(
      deriveTicketContext({
        boards,
        agreements,
        contacts,
        users,
        clientDefaults: { defaultAgreementId: "a-managed", accountManager: "Ada Lovelace" },
        project: { agreementId: "a-proj", managerId: "u-mgr", phases: [{ id: "ph1" }] },
      }),
    ).toEqual({
      contactId: "c-primary",
      // The project's agreement beats the client's managed default...
      agreementId: "a-proj",
      // ...and a project ticket belongs on the Projects board regardless.
      boardId: "b-proj",
      // Sole phase, so there is nothing to choose.
      projectPhaseId: "ph1",
      // The manager owns the work, not the account manager.
      assigneeIds: ["u-mgr"],
    });
  });

  it("honours a client's configured board for ad-hoc work", () => {
    const ctx = deriveTicketContext({
      boards,
      agreements,
      contacts,
      users,
      clientDefaults: { defaultBoardId: "b-svc", defaultAgreementId: "a-managed" },
    });
    expect(ctx.boardId).toBe("b-svc");
  });

  it("still puts project work on the Projects board despite a configured default", () => {
    // The client's default is about where their ad-hoc work lands; honouring it
    // here is how a project's tickets end up scattered.
    const ctx = deriveTicketContext({
      boards,
      agreements,
      contacts,
      users,
      clientDefaults: { defaultBoardId: "b-svc" },
      project: { phases: [] },
    });
    expect(ctx.boardId).toBe("b-proj");
  });

  it("ignores a configured board that is no longer active", () => {
    const ctx = deriveTicketContext({
      boards,
      agreements,
      contacts,
      users,
      clientDefaults: { defaultBoardId: "retired", defaultAgreementId: "a-managed" },
    });
    expect(ctx.boardId).toBe("b-msa");
  });

  it("never auto-selects an agreement the client cannot pick", () => {
    const ctx = deriveTicketContext({
      boards,
      agreements,
      contacts,
      users,
      clientDefaults: { defaultAgreementId: "someone-elses" },
    });
    expect(ctx.agreementId).toBe("");
  });

  it("lets explicit requests override every derived value", () => {
    expect(
      deriveTicketContext({
        boards,
        agreements,
        contacts,
        users,
        clientDefaults: { defaultAgreementId: "a-managed", accountManager: "Ada Lovelace" },
        project: { agreementId: "a-proj", managerId: "u-mgr", phases: [{ id: "ph1" }, { id: "ph2" }] },
        requested: {
          agreementId: "a-block",
          contactId: "c-other",
          projectPhaseId: "ph2",
          assigneeIds: ["u-am"],
        },
      }),
    ).toEqual({
      contactId: "c-other",
      agreementId: "a-block",
      boardId: "b-proj",
      projectPhaseId: "ph2",
      assigneeIds: ["u-am"],
    });
  });

  it("copes with an install that has no boards yet", () => {
    expect(deriveTicketContext({ boards: [], agreements: [], contacts: [], users: [] })).toEqual({
      contactId: "",
      agreementId: "",
      boardId: "",
      projectPhaseId: "",
      assigneeIds: [],
    });
  });
});
