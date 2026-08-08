import { describe, it, expect } from "vitest";
import {
  describeImport,
  importAction,
  mapPriority,
  matchStatus,
  matchTechnician,
  extractTicketDetail,
  htmlToText,
  mapSource,
  summaryFrom,
  worklogHours,
  type ImportCounts,
  type StatusOption,
} from "@/lib/silverfang/ticket-import";

describe("mapPriority", () => {
  it("maps the obvious words", () => {
    expect(mapPriority("Critical")).toBe("P1");
    expect(mapPriority("Urgent")).toBe("P1");
    expect(mapPriority("High")).toBe("P2");
    expect(mapPriority("Low")).toBe("P4");
  });

  it("passes through explicit P-codes", () => {
    for (const p of ["P1", "p2", "P4"] as const) {
      expect(mapPriority(p)).toBe(p.toUpperCase());
    }
  });

  it("falls back to P3 rather than dropping the ticket", () => {
    // A slightly wrong priority is recoverable; a missing ticket is not.
    expect(mapPriority("Whatever")).toBe("P3");
    expect(mapPriority(null)).toBe("P3");
    expect(mapPriority("")).toBe("P3");
  });
});

const statuses: StatusOption[] = [
  { id: "new", name: "New", isDefault: true, isClosed: false },
  { id: "prog", name: "In Progress", isDefault: false, isClosed: false },
  { id: "closed", name: "Closed", isDefault: false, isClosed: true },
];

describe("matchStatus", () => {
  it("matches an exact name, ignoring case and punctuation", () => {
    expect(matchStatus("In Progress", statuses)).toEqual({ statusId: "prog", via: "name" });
    expect(matchStatus("in-progress", statuses)?.statusId).toBe("prog");
  });

  it("lands a closed-sounding source status on a closed one", () => {
    // Getting the open/closed side right matters more than the label: finished
    // work arriving open goes back into somebody's queue.
    for (const name of ["Resolved", "Completed", "Cancelled", "Done"]) {
      expect(matchStatus(name, statuses)?.statusId, name).toBe("closed");
    }
    expect(matchStatus("Resolved", statuses)?.via).toBe("closed");
  });

  it("falls back to the open default for anything unrecognised", () => {
    const m = matchStatus("Awaiting Vendor", statuses);
    expect(m).toEqual({ statusId: "new", via: "open-default" });
  });

  it("never picks a closed status as the fallback", () => {
    const withClosedDefault: StatusOption[] = [
      { id: "c", name: "Closed", isDefault: true, isClosed: true },
      { id: "o", name: "Open", isDefault: false, isClosed: false },
    ];
    expect(matchStatus("Mystery", withClosedDefault)?.statusId).toBe("o");
  });

  it("uses whatever exists when every status is closed", () => {
    const allClosed: StatusOption[] = [
      { id: "c", name: "Closed", isDefault: true, isClosed: true },
    ];
    expect(matchStatus("Mystery", allClosed)).toEqual({ statusId: "c", via: "default" });
  });

  it("returns null only when the board has no statuses", () => {
    expect(matchStatus("New", [])).toBeNull();
  });

  it("handles a missing source status", () => {
    expect(matchStatus(null, statuses)?.statusId).toBe("new");
  });
});

describe("importAction", () => {
  it("creates when there is nothing here yet", () => {
    expect(importAction({ existing: null, overwrite: false })).toBe("create");
    expect(importAction({ existing: null, overwrite: true })).toBe("create");
  });

  it("skips an existing ticket when overwrite is off", () => {
    // The safe answer, and the default.
    expect(
      importAction({ existing: { id: "t", closedAt: null }, overwrite: false }),
    ).toBe("skip");
  });

  it("overwrites an open existing ticket when overwrite is on", () => {
    expect(
      importAction({ existing: { id: "t", closedAt: null }, overwrite: true }),
    ).toBe("overwrite");
  });

  it("never reopens a ticket somebody closed here, even with overwrite on", () => {
    // Reopening finished work is a change nobody asked for; a stale source is the
    // likelier explanation.
    expect(
      importAction({ existing: { id: "t", closedAt: new Date() }, overwrite: true }),
    ).toBe("skip");
  });
});

describe("matchTechnician", () => {
  const users = [
    { id: "u1", name: "Sam Jones", email: "sam@wolfstrata.com" },
    { id: "u2", name: "Jo Blake", email: "jo@wolfstrata.com" },
    { id: "u3", name: "Sam Jones", email: "sam.jones@wolfstrata.com" },
  ];

  it("matches a unique display name", () => {
    expect(matchTechnician("Jo Blake", users)).toBe("u2");
  });

  it("refuses an ambiguous name rather than guessing", () => {
    // Two Sam Joneses: assigning to the wrong one is worse than leaving it blank.
    expect(matchTechnician("Sam Jones", users)).toBeNull();
  });

  it("matches a full address or its local part", () => {
    expect(matchTechnician("jo@wolfstrata.com", users)).toBe("u2");
    expect(matchTechnician("jo", users)).toBe("u2");
  });

  it("returns null for nobody and for no input", () => {
    expect(matchTechnician("Nobody Here", users)).toBeNull();
    expect(matchTechnician(null, users)).toBeNull();
    expect(matchTechnician("  ", users)).toBeNull();
  });
});

describe("summaryFrom", () => {
  it("uses the subject, collapsed", () => {
    expect(summaryFrom("  Salesforce   not working ", null)).toBe("Salesforce not working");
  });

  it("never leaves it blank", () => {
    expect(summaryFrom("", "SO-42")).toBe("Imported ticket SO-42");
    expect(summaryFrom(null, null)).toBe("Imported ticket (no subject)");
  });

  it("bounds the length to the column", () => {
    expect(summaryFrom("x".repeat(500), null)).toHaveLength(300);
  });
});

describe("describeImport", () => {
  const base: ImportCounts = {
    available: 10,
    created: 4,
    overwritten: 0,
    skippedExisting: 6,
    skippedClosed: 0,
    skippedNoClient: 0,
    truncated: false,
  };

  it("says nothing was stored when the sync has not run", () => {
    expect(describeImport({ ...base, available: 0 }, false)).toContain(
      "run the SuperOps ticket sync first",
    );
  });

  it("offers the overwrite re-run when rows were left alone", () => {
    const text = describeImport(base, false);
    expect(text).toContain("6 left as they are");
    expect(text).toContain("overwrite on");
  });

  it("reports overwrites when overwrite was on", () => {
    const text = describeImport({ ...base, overwritten: 6, skippedExisting: 0 }, true);
    expect(text).toContain("6 overwritten");
    expect(text).not.toContain("overwrite on to refresh");
  });

  it("names the closed and unlinked skips", () => {
    const text = describeImport({ ...base, skippedClosed: 2, skippedNoClient: 3 }, true);
    expect(text).toContain("2 skipped (closed here)");
    expect(text).toContain("3 skipped (client not linked)");
    expect(text).toContain("Clients page");
  });

  it("says when the run was truncated", () => {
    expect(describeImport({ ...base, truncated: true }, false)).toContain("run it again");
  });
});

describe("htmlToText", () => {
  it("turns a rich-text description into readable lines", () => {
    // SuperOps descriptions are usually HTML; storing the markup verbatim would
    // render as tag soup in the ticket body.
    const html = "<p>Server is down.</p><p>Tried:<br/>reboot</p>";
    expect(htmlToText(html)).toBe("Server is down.\n\nTried:\nreboot");
  });

  it("keeps list items readable", () => {
    expect(htmlToText("<ul><li>One</li><li>Two</li></ul>")).toBe("• One\n• Two");
  });

  it("decodes the common entities", () => {
    expect(htmlToText("Tom &amp; Jerry &lt;test&gt; &quot;x&quot;&nbsp;y")).toBe(
      'Tom & Jerry <test> "x" y',
    );
  });

  it("drops script and style content entirely", () => {
    expect(htmlToText("<style>p{color:red}</style><p>Hi</p>")).toBe("Hi");
    expect(htmlToText("<script>alert(1)</script>Hi")).toBe("Hi");
  });

  it("returns empty for markup with no text", () => {
    expect(htmlToText("<p></p>")).toBe("");
  });
});

describe("mapSource", () => {
  it("recognises the channels that matter", () => {
    expect(mapSource("Email")).toBe("EMAIL");
    expect(mapSource("Inbound Call")).toBe("PHONE");
    expect(mapSource("RMM Alert")).toBe("ALERT");
  });

  it("defaults to PORTAL", () => {
    expect(mapSource("Web Form")).toBe("PORTAL");
    expect(mapSource(null)).toBe("PORTAL");
  });
});

describe("extractTicketDetail", () => {
  it("reads a flat SuperOps shape", () => {
    const d = extractTicketDetail({
      description: "<p>VPN is down</p>",
      requesterEmail: "Jane@McFaddenBenefits.com",
      category: "Network",
      subCategory: "VPN",
      source: "Email",
      site: "Head Office",
      resolvedTime: "2026-08-05T10:00:00Z",
    });
    expect(d.description).toBe("VPN is down");
    // Lower-cased, because that is how the contact blind index is keyed.
    expect(d.requesterEmail).toBe("jane@mcfaddenbenefits.com");
    expect(d.category).toBe("Network");
    expect(d.subCategory).toBe("VPN");
    expect(d.source).toBe("EMAIL");
    expect(d.siteName).toBe("Head Office");
    expect(d.resolvedAt?.toISOString()).toBe("2026-08-05T10:00:00.000Z");
  });

  it("reads a nested SuperOps shape", () => {
    // The introspected query returns some fields as objects; which ones varies by
    // tenant, so both shapes have to work.
    const d = extractTicketDetail({
      requester: { name: "Jane Doe", email: "jane@x.com" },
      category: { name: "Network" },
      source: { name: "Phone" },
      site: { name: "Branch" },
    });
    expect(d.requesterEmail).toBe("jane@x.com");
    expect(d.requesterName).toBe("Jane Doe");
    expect(d.category).toBe("Network");
    expect(d.source).toBe("PHONE");
    expect(d.siteName).toBe("Branch");
  });

  it("accepts epoch timestamps in seconds or millis", () => {
    expect(extractTicketDetail({ closedTime: 1_754_400_000 }).closedAt?.getUTCFullYear()).toBe(
      2025,
    );
    expect(
      extractTicketDetail({ closedTime: 1_754_400_000_000 }).closedAt?.getUTCFullYear(),
    ).toBe(2025);
  });

  it("ignores a requester value that is not an address", () => {
    // A bare name in the requester field must not become an email.
    expect(extractTicketDetail({ requester: "Jane Doe" }).requesterEmail).toBeNull();
    expect(extractTicketDetail({ requester: "Jane Doe" }).requesterName).toBe("Jane Doe");
  });

  it("returns all-null for junk rather than throwing", () => {
    for (const junk of [null, undefined, "string", 42, []]) {
      const d = extractTicketDetail(junk);
      expect(d.description).toBeNull();
      expect(d.requesterEmail).toBeNull();
      // Source still has a usable default.
      expect(d.source).toBe("PORTAL");
    }
  });

  it("treats a description of only markup as absent", () => {
    expect(extractTicketDetail({ description: "<p>  </p>" }).description).toBeNull();
  });
});

describe("worklogHours", () => {
  it("converts minutes to hours", () => {
    expect(worklogHours(90)).toBe(1.5);
    expect(worklogHours(30)).toBe(0.5);
    expect(worklogHours(100)).toBe(1.67);
  });

  it("returns null for nothing worth importing", () => {
    // A zero-minute worklog is not an hour of work; importing it would add a
    // meaningless row to somebody's timesheet.
    expect(worklogHours(0)).toBeNull();
    expect(worklogHours(null)).toBeNull();
    expect(worklogHours(-5)).toBeNull();
  });
});
