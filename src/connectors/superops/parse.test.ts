import { describe, it, expect } from "vitest";
import {
  firstObjectArray,
  pickMinutes,
  pickName,
  pickAccountId,
  parseClient,
  parseContact,
  parseAsset,
  parseContract,
  parseTicket,
  pickTicketIdArg,
  ticketIdCandidates,
  parseWorklog,
} from "@/connectors/superops/parse";

describe("firstObjectArray", () => {
  it("finds a nested array of objects", () => {
    const data = { getTicketList: { tickets: [{ ticketId: "1" }], listInfo: { totalCount: 1 } } };
    expect(firstObjectArray(data)?.[0]).toEqual({ ticketId: "1" });
  });
  it("returns null when there is no object array", () => {
    expect(firstObjectArray({ a: 1, b: "x" })).toBeNull();
  });
});

describe("pickName", () => {
  it("reads a plain string", () => {
    expect(pickName({ technician: "Alice" }, ["technician"])).toBe("Alice");
  });
  it("reads a nested object's name/email", () => {
    expect(pickName({ technician: { name: "Bob" } }, ["technician"])).toBe("Bob");
    expect(pickName({ owner: { email: "c@x.com" } }, ["owner"])).toBe("c@x.com");
  });
});

describe("pickAccountId", () => {
  it("reads a nested client.accountId", () => {
    expect(pickAccountId({ client: { accountId: "42" } })).toBe("42");
  });
  it("falls back to a flat clientId", () => {
    expect(pickAccountId({ clientId: "7" })).toBe("7");
  });
});

describe("pickMinutes", () => {
  it("uses explicit minutes", () => {
    expect(pickMinutes({ minutes: 90 })).toBe(90);
  });
  it("converts seconds to minutes", () => {
    expect(pickMinutes({ timeSpent: 5400 })).toBe(90);
  });
  it("converts hours to minutes", () => {
    expect(pickMinutes({ hours: 1.5 })).toBe(90);
  });
  it("returns null when absent", () => {
    expect(pickMinutes({})).toBeNull();
  });
});

describe("entity parsers", () => {
  it("parses a client with domains + nested account manager", () => {
    const c = parseClient({
      accountId: "413704",
      name: "Alair Homes",
      stage: "ACTIVE",
      status: "Active",
      accountManager: { name: "Jordan" },
      emailDomains: ["alair.com", "alairhomes.com"],
    });
    expect(c).toMatchObject({
      superOpsId: "413704",
      name: "Alair Homes",
      accountManager: "Jordan",
      emailDomains: ["alair.com", "alairhomes.com"],
    });
  });

  it("splits a comma-separated emailDomains string", () => {
    expect(parseClient({ accountId: "1", name: "X", emailDomains: "a.com, b.com" })?.emailDomains).toEqual([
      "a.com",
      "b.com",
    ]);
  });

  it("returns null for a client with no id", () => {
    expect(parseClient({ name: "No Id" })).toBeNull();
  });

  it("parses a contact", () => {
    expect(
      parseContact({ userId: "u1", name: "Sam", email: "s@x.com", contactNumber: "555", role: "Owner" }),
    ).toEqual({ superOpsId: "u1", name: "Sam", email: "s@x.com", phone: "555", role: "Owner" });
  });

  it("parses an asset with a last-communicated timestamp", () => {
    const a = parseAsset({ assetId: "a1", name: "PC", serialNumber: "SN1", platform: "Windows", status: "Online", lastCommunicatedTime: "2026-07-01T00:00:00Z" });
    expect(a?.serialNumber).toBe("SN1");
    expect(a?.lastCommunicatedTime?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("parses a contract with dates", () => {
    const c = parseContract({ contractId: "k1", name: "MSA", contractStatus: "ACTIVE", startDate: "2026-01-01", endDate: "2026-12-31" });
    expect(c?.status).toBe("ACTIVE");
    expect(c?.startDate?.toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  it("parses a ticket with account + technician + times", () => {
    const t = parseTicket({
      ticketId: "t1",
      displayId: "#101",
      subject: "Server down",
      status: { name: "Open" },
      priority: "High",
      technician: { name: "Bob" },
      client: { accountId: "413704" },
      createdTime: "2026-07-01T10:00:00Z",
      updatedTime: "2026-07-02T10:00:00Z",
    });
    expect(t).toMatchObject({ superOpsId: "t1", accountId: "413704", status: "Open", technician: "Bob", priority: "High" });
    expect(t?.updatedTime?.toISOString()).toBe("2026-07-02T10:00:00.000Z");
  });

  it("parses a worklog with ticket link + minutes + billable", () => {
    const w = parseWorklog({
      worklogId: "w1",
      ticket: { ticketId: "t1" },
      client: { accountId: "413704" },
      technician: "Bob",
      timeSpent: 3600,
      billable: true,
      notes: "Fixed it",
      entryTime: "2026-07-01T11:00:00Z",
    });
    expect(w).toMatchObject({ superOpsId: "w1", ticketId: "t1", accountId: "413704", minutes: 60, billable: true });
  });
});

describe("pickTicketIdArg", () => {
  const arg = (name: string, required = true) => ({ name, required });

  it("picks the one argument that mentions the ticket", () => {
    expect(pickTicketIdArg([arg("ticketId")])?.name).toBe("ticketId");
    expect(pickTicketIdArg([arg("ticket_id"), arg("limit", false)])?.name).toBe("ticket_id");
  });

  it("prefers the plain ticket id over a display variant", () => {
    // We hold the SuperOps id, not the display id — fetching by a value we do
    // not have would return nothing and look like an empty history.
    expect(
      pickTicketIdArg([arg("ticketDisplayId"), arg("ticketId")])?.name,
    ).toBe("ticketId");
  });

  it("falls back to a bare id, then to the sole required argument", () => {
    expect(pickTicketIdArg([arg("id"), arg("pageSize", false)])?.name).toBe("id");
    expect(pickTicketIdArg([arg("reference"), arg("verbose", false)])?.name).toBe("reference");
  });

  it("refuses to guess when the choice is ambiguous", () => {
    // Two equally ticket-ish names, or two required arguments: guessing wrong
    // fails every call, and a skipped failure reads as "no history".
    expect(pickTicketIdArg([arg("ticketRef"), arg("ticketKey")])).toBeNull();
    expect(pickTicketIdArg([arg("alpha"), arg("beta")])).toBeNull();
    expect(pickTicketIdArg([])).toBeNull();
  });

  it("ignores optional arguments when looking for the sole required one", () => {
    expect(pickTicketIdArg([arg("a", false), arg("b", false)])).toBeNull();
  });
});

describe("ticketIdCandidates", () => {
  const f = (name: string) => ({ name });

  it("takes a single-field input object whatever it is called", () => {
    expect(ticketIdCandidates([f("whatever")]).map((x) => x.name)).toEqual(["whatever"]);
  });

  it("orders ticket-ish names first, then bare id, then other ids", () => {
    expect(
      ticketIdCandidates([f("pageSize"), f("someId"), f("id"), f("ticketId")]).map((x) => x.name),
    ).toEqual(["ticketId", "id", "someId"]);
  });

  it("tries a display or reference id after the plain one", () => {
    // We hold the SuperOps id; a display id would fetch nothing and look like
    // an empty history rather than a wrong field.
    expect(
      ticketIdCandidates([f("ticketDisplayId"), f("ticketId")]).map((x) => x.name),
    ).toEqual(["ticketId", "ticketDisplayId"]);
  });

  it("lists each candidate once", () => {
    expect(ticketIdCandidates([f("ticketId"), f("ticketId2")]).map((x) => x.name)).toEqual([
      "ticketId",
      "ticketId2",
    ]);
  });

  it("returns nothing when no field looks like an id", () => {
    expect(ticketIdCandidates([f("alpha"), f("beta")])).toEqual([]);
  });
});
