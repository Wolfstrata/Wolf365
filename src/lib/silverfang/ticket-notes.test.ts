import { describe, it, expect } from "vitest";
import {
  classifyNote,
  describeNoteSync,
  extractEmbeddedNotes,
  isInternalNote,
  parseNote,
  type ParsedNote,
} from "@/lib/silverfang/ticket-notes";

const note = (over: Partial<ParsedNote> = {}): ParsedNote => ({
  externalId: "n1",
  kind: "note",
  isPrivate: null,
  author: null,
  authorEmail: null,
  body: "text",
  createdAt: null,
  ...over,
});

describe("classifyNote", () => {
  it("believes an explicit private flag", () => {
    expect(classifyNote({ isPrivate: true }).isPrivate).toBe(true);
    expect(classifyNote({ internal: true }).isPrivate).toBe(true);
  });

  it("believes an explicit public flag, inverted", () => {
    expect(classifyNote({ isPublic: true }).isPrivate).toBe(false);
    expect(classifyNote({ visibleToClient: false }).isPrivate).toBe(true);
  });

  it("lets an explicit flag beat the type text", () => {
    // The flag is data; the text is inference.
    expect(classifyNote({ type: "Private Note", isPublic: true }).isPrivate).toBe(false);
  });

  it("infers from the type text when there is no flag", () => {
    expect(classifyNote({ type: "Private Note" }).isPrivate).toBe(true);
    expect(classifyNote({ type: "Public Reply" }).isPrivate).toBe(false);
    expect(classifyNote({ noteType: "Email" }).isPrivate).toBe(false);
  });

  it("returns null when nothing says either way", () => {
    // Null is meaningful: the importer reads it as private.
    expect(classifyNote({}).isPrivate).toBeNull();
    expect(classifyNote({ body: "hello" }).isPrivate).toBeNull();
  });

  it("recognises system entries", () => {
    expect(classifyNote({ type: "System" }).kind).toBe("system");
    expect(classifyNote({ type: "Status Change" }).kind).toBe("system");
  });

  it("recognises client-facing replies", () => {
    expect(classifyNote({ type: "Reply" }).kind).toBe("reply");
    expect(classifyNote({ type: "Incoming Email" }).kind).toBe("reply");
  });

  it("copes with junk", () => {
    expect(classifyNote(null).isPrivate).toBeNull();
    expect(classifyNote("nope").kind).toBe("note");
  });
});

describe("isInternalNote", () => {
  it("treats unknown as internal", () => {
    // The safety rule: an internal note leaked to a client is not recoverable, a
    // client reply marked internal is cosmetic.
    expect(isInternalNote(note({ isPrivate: null }))).toBe(true);
  });

  it("honours a known public entry", () => {
    expect(isInternalNote(note({ isPrivate: false }))).toBe(false);
  });

  it("always keeps system entries internal", () => {
    expect(isInternalNote(note({ kind: "system", isPrivate: false }))).toBe(true);
  });
});

describe("parseNote", () => {
  it("reads body, author and time from the common shapes", () => {
    const n = parseNote(
      {
        id: "c1",
        content: "We restarted the server.",
        createdBy: { name: "Sam Jones", email: "sam@wolfstrata.com" },
        createdTime: "2026-08-05T09:00:00Z",
        isPrivate: false,
      },
      "fallback",
    );
    expect(n).toMatchObject({
      externalId: "c1",
      body: "We restarted the server.",
      author: "Sam Jones",
      authorEmail: "sam@wolfstrata.com",
      isPrivate: false,
    });
    expect(n!.createdAt?.toISOString()).toBe("2026-08-05T09:00:00.000Z");
  });

  it("falls back to a synthesised id", () => {
    // Without a stable key a re-import duplicates the whole conversation, which is
    // the most visible way an import can be wrong.
    expect(parseNote({ body: "x" }, "T1:notes:0")!.externalId).toBe("T1:notes:0");
  });

  it("drops an entry with no body", () => {
    // Status changes ride in the same collection; there is nothing to carry over.
    expect(parseNote({ type: "Status Change", id: "s1" }, "f")).toBeNull();
    expect(parseNote({}, "f")).toBeNull();
  });

  it("returns null for junk", () => {
    expect(parseNote(null, "f")).toBeNull();
    expect(parseNote("string", "f")).toBeNull();
  });
});

describe("extractEmbeddedNotes", () => {
  it("finds a conversation under any of the likely keys", () => {
    for (const key of ["conversations", "notes", "comments", "replies"]) {
      const notes = extractEmbeddedNotes({ [key]: [{ body: "hi" }] }, "T1");
      expect(notes, key).toHaveLength(1);
    }
  });

  it("orders oldest first, so the thread reads forwards", () => {
    const notes = extractEmbeddedNotes(
      {
        conversations: [
          { id: "b", body: "second", createdTime: "2026-08-05T10:00:00Z" },
          { id: "a", body: "first", createdTime: "2026-08-05T09:00:00Z" },
        ],
      },
      "T1",
    );
    expect(notes.map((n) => n.body)).toEqual(["first", "second"]);
  });

  it("does not repeat an entry that appears under two keys", () => {
    const entry = { id: "same", body: "hi" };
    expect(extractEmbeddedNotes({ conversations: [entry], notes: [entry] }, "T1")).toHaveLength(1);
  });

  it("gives distinct fallback ids so unkeyed entries survive dedupe", () => {
    const notes = extractEmbeddedNotes({ notes: [{ body: "one" }, { body: "two" }] }, "T1");
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((n) => n.externalId)).size).toBe(2);
  });

  it("returns nothing when there is no conversation embedded", () => {
    // Which is the signal to go and fetch them.
    expect(extractEmbeddedNotes({ subject: "x" }, "T1")).toEqual([]);
    expect(extractEmbeddedNotes(null, "T1")).toEqual([]);
  });

  it("ignores a key that is not an array", () => {
    expect(extractEmbeddedNotes({ notes: "some string" }, "T1")).toEqual([]);
  });
});

describe("describeNoteSync", () => {
  const base = { notes: 0, ticketsScanned: 262, fromEmbedded: 0, queryUsed: "getTicketConversation" };

  it("never calls a zero a success, however it arose", () => {
    // The whole point: no combination of inputs yields ok:true with 0 notes.
    const zeros = [
      { ...base, failedTickets: 262, firstError: "Unknown argument 'ticketId'" },
      { ...base, queryUsed: null },
      { ...base, unparsedRecords: 40 },
      { ...base, emptyTickets: 262 },
      { ...base, error: "introspection disabled" },
      { ...base, ticketsScanned: 0 },
    ];
    for (const r of zeros) expect(describeNoteSync(r).ok).toBe(false);
  });

  it("names the failure and quotes SuperOps when every call errored", () => {
    const r = describeNoteSync({
      ...base,
      failedTickets: 262,
      argUsed: "ticketId: ID!",
      firstError: "Unknown argument 'ticketId' on field 'getTicketConversation'",
    });
    expect(r.message).toContain("all 262 conversation call(s) failed");
    expect(r.message).toContain("ticketId: ID!");
    expect(r.message).toContain("Unknown argument");
    expect(r.message).toContain("do not cut over");
  });

  it("distinguishes no-query from no-history from unreadable records", () => {
    expect(describeNoteSync({ ...base, queryUsed: null }).message).toContain(
      "exposes no conversation query",
    );
    expect(describeNoteSync({ ...base, unparsedRecords: 40 }).message).toContain(
      "none of which had a readable body",
    );
    expect(describeNoteSync({ ...base, emptyTickets: 262 }).message).toContain(
      "confirm a ticket you know has replies",
    );
  });

  it("says so when there are no tickets to scan yet", () => {
    expect(describeNoteSync({ ...base, ticketsScanned: 0 }).message).toContain(
      "run the ticket sync first",
    );
  });

  it("reports a clean run as success", () => {
    const r = describeNoteSync({ ...base, notes: 900, fromEmbedded: 120 });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("900 conversation entries mirrored from 262 ticket(s)");
    expect(r.message).toContain("120 already embedded");
    expect(r.message).toContain("Import them below.");
  });

  it("refuses to call a partial run a success, and says what was lost", () => {
    // 900 notes is not "done" when 12 tickets errored — those are the ones that
    // will be missing after the subscription ends.
    const r = describeNoteSync({
      ...base,
      notes: 900,
      failedTickets: 12,
      unparsedRecords: 3,
      firstError: "HTTP 500",
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Incomplete");
    expect(r.message).toContain("12 ticket(s) failed: HTTP 500");
    expect(r.message).toContain("3 record(s) were unreadable");
  });

  it("uses singular wording for one entry", () => {
    expect(describeNoteSync({ ...base, notes: 1, queryUsed: null }).message).toContain(
      "1 conversation entry",
    );
  });
});
