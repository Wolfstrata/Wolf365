import { describe, it, expect } from "vitest";
import {
  calendarEventFor,
  eventNeedsUpdate,
  shouldSyncBlock,
  SKIP_LABELS,
  type SyncableBlock,
  type SyncTarget,
} from "@/lib/silverfang/calendar-sync";

const target: SyncTarget = {
  calendarMailbox: "tech@wolfstrata.com",
  calendarSyncEnabled: true,
  active: true,
};

function block(over: Partial<SyncableBlock> = {}): SyncableBlock {
  return {
    id: "e1",
    startedAt: new Date("2026-08-10T14:00:00Z"),
    endedAt: new Date("2026-08-10T15:30:00Z"),
    notes: null,
    internalOnly: false,
    ticketNumber: 1042,
    ticketSummary: "Exchange connector failing",
    clientName: "Acme Ltd",
    chargeCodeName: "Remote support",
    ...over,
  };
}

describe("shouldSyncBlock", () => {
  it("syncs a timed block for an enabled profile", () => {
    expect(shouldSyncBlock(block(), target)).toEqual({ sync: true });
  });

  it("refuses with a named reason rather than a bare false", () => {
    // "I turned sync on and my calendar is still empty" has to be answerable.
    expect(shouldSyncBlock(block(), { ...target, calendarSyncEnabled: false })).toEqual({
      sync: false,
      reason: "sync-disabled",
    });
    expect(shouldSyncBlock(block(), { ...target, calendarMailbox: null })).toEqual({
      sync: false,
      reason: "no-mailbox",
    });
    expect(shouldSyncBlock(block(), { ...target, calendarMailbox: "   " })).toEqual({
      sync: false,
      reason: "no-mailbox",
    });
    expect(shouldSyncBlock(block(), { ...target, active: false })).toEqual({
      sync: false,
      reason: "profile-inactive",
    });
  });

  it("does not place untimed time on a calendar", () => {
    // Most time is logged as a duration ("1.5h today"). Inventing a start so it
    // can be drawn on a calendar would put work at an hour nobody did it.
    expect(shouldSyncBlock(block({ startedAt: null }), target)).toEqual({
      sync: false,
      reason: "no-times",
    });
    expect(shouldSyncBlock(block({ endedAt: null }), target)).toEqual({
      sync: false,
      reason: "no-times",
    });
  });

  it("rejects a zero-length or reversed block", () => {
    const at = new Date("2026-08-10T14:00:00Z");
    expect(shouldSyncBlock(block({ startedAt: at, endedAt: at }), target)).toEqual({
      sync: false,
      reason: "zero-length",
    });
    expect(
      shouldSyncBlock(
        block({ startedAt: at, endedAt: new Date("2026-08-10T13:00:00Z") }),
        target,
      ),
    ).toEqual({ sync: false, reason: "reversed-times" });
  });

  it("checks the profile before the mailbox, so the cause is the root one", () => {
    // An inactive profile with no mailbox should report the profile: fixing the
    // mailbox would not make it sync.
    expect(
      shouldSyncBlock(block(), { calendarMailbox: null, calendarSyncEnabled: false, active: false }),
    ).toEqual({ sync: false, reason: "profile-inactive" });
  });

  it("has a label for every reason it can return", () => {
    for (const reason of Object.keys(SKIP_LABELS)) {
      expect(SKIP_LABELS[reason as keyof typeof SKIP_LABELS]).toBeTruthy();
    }
  });
});

describe("calendarEventFor", () => {
  it("leads the subject with the ticket number", () => {
    // So a tech scanning their day can match an entry to a ticket without opening
    // either one.
    const event = calendarEventFor(block());
    expect(event.subject).toBe("#1042 Exchange connector failing — Acme Ltd");
  });

  it("falls back to the charge code when there is no ticket", () => {
    const event = calendarEventFor(
      block({ ticketNumber: null, ticketSummary: null }),
    );
    expect(event.subject).toBe("Remote support — Acme Ltd");
  });

  it("still produces a subject with nothing to describe it", () => {
    const event = calendarEventFor(
      block({ ticketNumber: null, ticketSummary: null, chargeCodeName: null, clientName: null }),
    );
    expect(event.subject).toBe("Scheduled work");
  });

  it("truncates a long subject", () => {
    const event = calendarEventFor(block({ ticketSummary: "x".repeat(300) }));
    expect(event.subject.length).toBeLessThanOrEqual(120);
    expect(event.subject.endsWith("…")).toBe(true);
  });

  it("includes visible notes in the body", () => {
    const event = calendarEventFor(block({ notes: "Bring the spare switch" }));
    expect(event.body).toContain("Bring the spare switch");
  });

  it("omits internal-only notes", () => {
    // "Internal only" is a promise about where that text goes. A calendar event is
    // somewhere else, even on a staff mailbox.
    const event = calendarEventFor(
      block({ notes: "Client is disputing the invoice", internalOnly: true }),
    );
    expect(event.body).not.toContain("disputing");
  });

  it("says the event is generated and will be overwritten", () => {
    // Sync is one-way, so an edit made in Outlook is lost. Saying so on the event
    // is cheaper than explaining it afterwards.
    expect(calendarEventFor(block()).body).toContain("overwritten");
  });

  it("emits UTC instants", () => {
    const event = calendarEventFor(block());
    expect(event.startIso).toBe("2026-08-10T14:00:00.000Z");
    expect(event.endIso).toBe("2026-08-10T15:30:00.000Z");
  });

  it("throws rather than guessing when the times are missing", () => {
    // shouldSyncBlock is the gate; reaching here without times is a caller bug and
    // must not silently produce an event at an invented time.
    expect(() => calendarEventFor(block({ startedAt: null }))).toThrow();
  });
});

describe("eventNeedsUpdate", () => {
  const link = {
    startAt: new Date("2026-08-10T14:00:00Z"),
    endAt: new Date("2026-08-10T15:30:00Z"),
  };

  it("is false when the window is unchanged", () => {
    // Otherwise every cron pass PATCHes every event, which reads as constant
    // churn in the mailbox's audit log.
    expect(eventNeedsUpdate(link, block())).toBe(false);
  });

  it("is true when either end moved", () => {
    expect(eventNeedsUpdate(link, block({ startedAt: new Date("2026-08-10T14:15:00Z") }))).toBe(
      true,
    );
    expect(eventNeedsUpdate(link, block({ endedAt: new Date("2026-08-10T16:00:00Z") }))).toBe(true);
  });

  it("is false for a block that lost its times", () => {
    // Deleting the event is the caller's job; this only answers "rewrite it?".
    expect(eventNeedsUpdate(link, block({ startedAt: null }))).toBe(false);
  });
});
