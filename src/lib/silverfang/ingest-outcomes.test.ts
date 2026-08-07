import { describe, it, expect } from "vitest";
import {
  decisionOf,
  describeDecision,
  needsAttention,
  summarizePoll,
  type MailDecision,
} from "@/lib/silverfang/ingest-outcomes";

const ALL: MailDecision[] = [
  "created",
  "appended",
  "deduped",
  "missing-sender",
  "loop-self",
  "auto-reply",
  "unknown-sender",
  "no-board",
  "no-mailbox",
  "error",
];

describe("describeDecision", () => {
  it.each(ALL)("describes %s", (decision) => {
    const info = describeDecision(decision);
    expect(info.label).toBeTruthy();
    expect(info.explanation).toBeTruthy();
  });

  it("gives every problem a remedy, and no ignored outcome one", () => {
    // The point of the distinction: a "problem" means mail did not land and
    // someone has to act, so it must say what to do. An "ignored" outcome is
    // working as intended, and offering a fix would invite breaking it.
    for (const decision of ALL) {
      const info = describeDecision(decision);
      if (info.kind === "problem") expect(info.remedy, decision).toBeTruthy();
      if (info.kind === "ignored") expect(info.remedy, decision).toBeUndefined();
    }
  });

  it("treats the deliberate skips as nothing to fix", () => {
    expect(describeDecision("auto-reply").kind).toBe("ignored");
    expect(describeDecision("loop-self").kind).toBe("ignored");
    expect(describeDecision("deduped").kind).toBe("ignored");
  });

  it("treats configuration gaps and faults as problems", () => {
    expect(describeDecision("unknown-sender").kind).toBe("problem");
    expect(describeDecision("no-mailbox").kind).toBe("problem");
    expect(describeDecision("no-board").kind).toBe("problem");
    expect(describeDecision("missing-sender").kind).toBe("problem");
    expect(describeDecision("error").kind).toBe("problem");
  });

  it("counts a filed message as filed", () => {
    expect(describeDecision("created").kind).toBe("filed");
    expect(describeDecision("appended").kind).toBe("filed");
  });

  it("degrades an unrecognised decision to a problem rather than throwing", () => {
    // A row written by a newer version must still render, and must not be shown
    // as fine when we cannot say that it is.
    const info = describeDecision("something-new");
    expect(info.kind).toBe("problem");
    expect(info.label).toBe("something-new");
  });
});

describe("needsAttention", () => {
  it("flags only the problems", () => {
    expect(needsAttention("unknown-sender")).toBe(true);
    expect(needsAttention("error")).toBe(true);
    expect(needsAttention("auto-reply")).toBe(false);
    expect(needsAttention("created")).toBe(false);
  });
});

describe("decisionOf", () => {
  it("reads the action from a success", () => {
    expect(
      decisionOf({ ok: true, action: "created", ticketId: "t1", ticketNumber: 1001 }),
    ).toBe("created");
    expect(decisionOf({ ok: true, action: "deduped", ticketId: "t1" })).toBe("deduped");
  });

  it("reads the reason from a skip", () => {
    expect(decisionOf({ ok: false, reason: "unknown-sender" })).toBe("unknown-sender");
  });
});

describe("summarizePoll", () => {
  it("names the skips instead of only counting successes", () => {
    // The bug this fixes: "1 fetched, 0 new ticket(s)" told the operator nothing
    // about why the one message did not become a ticket.
    const line = summarizePoll({
      fetched: 3,
      created: 1,
      appended: 0,
      deduped: 0,
      skipped: { "unknown-sender": 2 },
    });
    expect(line).toContain("3 fetched");
    expect(line).toContain("1 new ticket(s)");
    expect(line).toContain("2 sender not recognised");
  });

  it("distinguishes an empty mailbox from a mailbox where nothing was filed", () => {
    expect(
      summarizePoll({ fetched: 0, created: 0, appended: 0, deduped: 0, skipped: {} }),
    ).toContain("nothing new in the mailbox");
    // Reporting this the same way as an empty mailbox is what hid the problem.
    expect(
      summarizePoll({ fetched: 4, created: 0, appended: 0, deduped: 0, skipped: {} }),
    ).toContain("none filed");
  });

  it("omits zero counts", () => {
    const line = summarizePoll({
      fetched: 1,
      created: 1,
      appended: 0,
      deduped: 0,
      skipped: { "auto-reply": 0 },
    });
    expect(line).toBe("1 fetched, 1 new ticket(s)");
  });
});
