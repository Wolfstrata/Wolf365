import { describe, it, expect } from "vitest";
import {
  companyKey,
  describeTier,
  domainRoot,
  groupUnknownSenders,
  suggestClientForDomain,
} from "@/lib/silverfang/sender-match";

describe("domainRoot", () => {
  it("takes the company label", () => {
    expect(domainRoot("mcfaddenbenefits.com")).toBe("mcfaddenbenefits");
    expect(domainRoot("egpenner.com")).toBe("egpenner");
  });

  it("sees past subdomains", () => {
    expect(domainRoot("mail.corp.acme.com")).toBe("acme");
  });

  it("sees past two-part public suffixes", () => {
    expect(domainRoot("acme.co.uk")).toBe("acme");
    expect(domainRoot("acme.com.au")).toBe("acme");
    expect(domainRoot("mail.acme.co.nz")).toBe("acme");
  });

  it("normalises case and a trailing dot", () => {
    expect(domainRoot("ACME.COM.")).toBe("acme");
  });

  it("returns empty for nothing usable", () => {
    expect(domainRoot(null)).toBe("");
    expect(domainRoot("")).toBe("");
    expect(domainRoot("   ")).toBe("");
  });
});

describe("companyKey", () => {
  it("keeps only letters and digits", () => {
    expect(companyKey("McFadden Benefits, Inc.")).toBe("mcfaddenbenefitsinc");
    expect(companyKey("E.G. Penner")).toBe("egpenner");
  });
});

const clients = [
  { id: "c1", name: "McFadden Benefits" },
  { id: "c2", name: "EG Penner Building Centres" },
  { id: "c3", name: "Acme Ltd" },
];

describe("suggestClientForDomain", () => {
  it("prefers a domain recorded on the client", () => {
    const s = suggestClientForDomain({
      domain: "somethingelse.com",
      clients,
      domainOwners: { "somethingelse.com": "c3" },
    });
    // Recorded fact beats every kind of name inference.
    expect(s).toEqual({ clientId: "c3", clientName: "Acme Ltd", tier: "domain" });
  });

  it("matches a client name once punctuation and case are ignored", () => {
    const s = suggestClientForDomain({ domain: "mcfaddenbenefits.com", clients });
    expect(s).toEqual({
      clientId: "c1",
      clientName: "McFadden Benefits",
      tier: "name",
    });
  });

  it("ignores a corporate suffix on the client name", () => {
    const s = suggestClientForDomain({ domain: "acme.com", clients });
    expect(s?.clientId).toBe("c3");
    expect(s?.tier).toBe("name");
  });

  it("falls back to a containment match, labelled as weaker", () => {
    const s = suggestClientForDomain({ domain: "egpenner.com", clients });
    expect(s?.clientId).toBe("c2");
    expect(s?.tier).toBe("partial");
  });

  it("suggests nothing when two clients match equally", () => {
    // Ambiguity must reach the operator. Picking one would be a coin flip that
    // attaches a person to the wrong company.
    const s = suggestClientForDomain({
      domain: "acme.com",
      clients: [
        { id: "a", name: "Acme" },
        { id: "b", name: "Acme Ltd" },
      ],
    });
    expect(s).toBeNull();
  });

  it("suggests nothing when nothing resembles the domain", () => {
    expect(suggestClientForDomain({ domain: "unrelated.com", clients })).toBeNull();
  });

  it("ignores a recorded domain whose client is not in the list", () => {
    // Archived or unlinked client: the id resolves to nothing selectable, so
    // offering it would produce a broken row.
    const s = suggestClientForDomain({
      domain: "gone.com",
      clients,
      domainOwners: { "gone.com": "deleted" },
    });
    expect(s).toBeNull();
  });

  it("refuses to guess from a very short root", () => {
    expect(suggestClientForDomain({ domain: "hp.com", clients })).toBeNull();
  });

  it("handles empty input", () => {
    expect(suggestClientForDomain({ domain: null, clients })).toBeNull();
    expect(suggestClientForDomain({ domain: "acme.com", clients: [] })).toBeNull();
  });
});

describe("describeTier", () => {
  it("says how strong each tier is", () => {
    expect(describeTier("domain")).toContain("SuperOps");
    expect(describeTier("name")).toContain("client name");
    expect(describeTier("partial")).toContain("check it");
  });
});

describe("groupUnknownSenders", () => {
  const at = (iso: string) => new Date(iso);

  it("collapses repeats into one row with a count", () => {
    // The screenshot case: the same person three times, because nobody replied.
    const groups = groupUnknownSenders([
      { address: "jane@x.com", subject: "Salesforce", at: at("2026-08-07T19:51:00Z"), mailbox: "help@w.com" },
      { address: "jane@x.com", subject: "Salesforce", at: at("2026-08-07T19:51:30Z"), mailbox: "help@w.com" },
      { address: "jane@x.com", subject: "Salesforce", at: at("2026-08-07T19:52:00Z"), mailbox: "help@w.com" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(3);
    expect(groups[0]!.domain).toBe("x.com");
  });

  it("keeps the most recent subject, not the first", () => {
    const groups = groupUnknownSenders([
      { address: "a@x.com", subject: "old", at: at("2026-08-01T00:00:00Z"), mailbox: null },
      { address: "a@x.com", subject: "new", at: at("2026-08-05T00:00:00Z"), mailbox: null },
    ]);
    expect(groups[0]!.lastSubject).toBe("new");
    expect(groups[0]!.lastAt.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  it("orders newest first", () => {
    const groups = groupUnknownSenders([
      { address: "old@x.com", subject: null, at: at("2026-08-01T00:00:00Z"), mailbox: null },
      { address: "new@y.com", subject: null, at: at("2026-08-06T00:00:00Z"), mailbox: null },
    ]);
    expect(groups.map((g) => g.address)).toEqual(["new@y.com", "old@x.com"]);
  });

  it("treats case differences as the same sender", () => {
    const groups = groupUnknownSenders([
      { address: "Jane@X.com", subject: null, at: at("2026-08-01T00:00:00Z"), mailbox: null },
      { address: "jane@x.com", subject: null, at: at("2026-08-02T00:00:00Z"), mailbox: null },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.address).toBe("jane@x.com");
  });

  it("drops rows with no address and copes with none at all", () => {
    expect(groupUnknownSenders([{ address: "  ", subject: null, at: at("2026-08-01T00:00:00Z"), mailbox: null }])).toEqual([]);
    expect(groupUnknownSenders([])).toEqual([]);
  });
});
