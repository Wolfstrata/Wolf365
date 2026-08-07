import { describe, it, expect } from "vitest";
import {
  compareTickets,
  priorityRank,
  queueSortKey,
  sortTickets,
  type OrderableTicket,
} from "@/lib/silverfang/ticket-order";

function t(over: Partial<OrderableTicket> & { number: number }): OrderableTicket {
  return {
    priority: "P3",
    createdAt: new Date("2026-08-10T12:00:00Z"),
    vip: false,
    ...over,
  };
}

describe("priorityRank", () => {
  it("puts P1 first", () => {
    expect(priorityRank("P1")).toBeLessThan(priorityRank("P2"));
    expect(priorityRank("P4")).toBeLessThan(priorityRank("P5"));
  });

  it("sorts an unknown priority after every known one", () => {
    // Rather than jumbling it among them, where it would look like a real position.
    expect(priorityRank("WHATEVER")).toBeGreaterThan(priorityRank("P5"));
  });
});

describe("compareTickets", () => {
  it("orders by priority first", () => {
    const order = sortTickets([
      t({ number: 1, priority: "P4" }),
      t({ number: 2, priority: "P1" }),
      t({ number: 3, priority: "P2" }),
    ]);
    expect(order.map((x) => x.number)).toEqual([2, 3, 1]);
  });

  it("puts a VIP above a non-VIP at the same priority", () => {
    const order = sortTickets([
      t({ number: 1, createdAt: new Date("2026-08-01T00:00:00Z") }),
      t({ number: 2, vip: true, createdAt: new Date("2026-08-09T00:00:00Z") }),
    ]);
    // The VIP ticket is NEWER and still comes first — which is the whole point of
    // ranking VIP above the date. Reverse those two and the flag does nothing.
    expect(order.map((x) => x.number)).toEqual([2, 1]);
  });

  it("never lets VIP outrank priority", () => {
    // A VIP's P4 request does not jump ahead of a P1 outage.
    const order = sortTickets([
      t({ number: 1, priority: "P4", vip: true }),
      t({ number: 2, priority: "P1", vip: false }),
    ]);
    expect(order.map((x) => x.number)).toEqual([2, 1]);
  });

  it("orders oldest first within a band", () => {
    // The oldest ticket at a priority is the one closest to breaching.
    const order = sortTickets([
      t({ number: 1, createdAt: new Date("2026-08-10T00:00:00Z") }),
      t({ number: 2, createdAt: new Date("2026-08-02T00:00:00Z") }),
      t({ number: 3, createdAt: new Date("2026-08-06T00:00:00Z") }),
    ]);
    expect(order.map((x) => x.number)).toEqual([2, 3, 1]);
  });

  it("accepts ISO strings as well as Dates", () => {
    const order = sortTickets([
      t({ number: 1, createdAt: "2026-08-10T00:00:00Z" }),
      t({ number: 2, createdAt: "2026-08-01T00:00:00Z" }),
    ]);
    expect(order.map((x) => x.number)).toEqual([2, 1]);
  });

  it("is total, so the order cannot reshuffle between renders", () => {
    const at = new Date("2026-08-10T12:00:00Z");
    const a = t({ number: 7, createdAt: at });
    const b = t({ number: 3, createdAt: at });
    expect(compareTickets(a, b)).toBeGreaterThan(0);
    expect(compareTickets(b, a)).toBeLessThan(0);
    expect(compareTickets(a, a)).toBe(0);
  });

  it("treats a missing vip flag as not VIP", () => {
    const order = sortTickets([
      t({ number: 1, vip: undefined }),
      t({ number: 2, vip: true }),
    ]);
    expect(order.map((x) => x.number)).toEqual([2, 1]);
  });

  it("does not mutate the input", () => {
    // A cached query result must not be reordered under whoever else holds it.
    const input = [t({ number: 1, priority: "P4" }), t({ number: 2, priority: "P1" })];
    const before = input.map((x) => x.number);
    sortTickets(input);
    expect(input.map((x) => x.number)).toEqual(before);
  });

  it("applies the full rule end to end", () => {
    const order = sortTickets([
      t({ number: 10, priority: "P3", createdAt: "2026-08-01T00:00:00Z" }),
      t({ number: 11, priority: "P1", createdAt: "2026-08-09T00:00:00Z" }),
      t({ number: 12, priority: "P3", vip: true, createdAt: "2026-08-08T00:00:00Z" }),
      t({ number: 13, priority: "P1", vip: true, createdAt: "2026-08-10T00:00:00Z" }),
      t({ number: 14, priority: "P3", createdAt: "2026-07-20T00:00:00Z" }),
    ]);
    // P1 VIP, P1, then P3 VIP, then the two P3s oldest first.
    expect(order.map((x) => x.number)).toEqual([13, 11, 12, 14, 10]);
  });
});

describe("queueSortKey", () => {
  it("sorts identically to the comparator", () => {
    // The table sorts by one column's value, so this string has to reproduce the
    // comparator exactly — otherwise the table silently discards the server order.
    const tickets = [
      t({ number: 10, priority: "P3", createdAt: "2026-08-01T00:00:00Z" }),
      t({ number: 11, priority: "P1", createdAt: "2026-08-09T00:00:00Z" }),
      t({ number: 12, priority: "P3", vip: true, createdAt: "2026-08-08T00:00:00Z" }),
      t({ number: 13, priority: "P1", vip: true, createdAt: "2026-08-10T00:00:00Z" }),
      t({ number: 14, priority: "P3", createdAt: "2026-07-20T00:00:00Z" }),
      t({ number: 15, priority: "P5", createdAt: "2026-01-01T00:00:00Z" }),
    ];
    const byComparator = sortTickets(tickets).map((x) => x.number);
    const byKey = [...tickets]
      .sort((a, b) => queueSortKey(a).localeCompare(queueSortKey(b)))
      .map((x) => x.number);
    expect(byKey).toEqual(byComparator);
  });

  it("pads so string comparison matches numeric order", () => {
    // "10" must not sort before "9": every component is fixed-width.
    const a = queueSortKey(t({ number: 9 }));
    const b = queueSortKey(t({ number: 10 }));
    expect(a < b).toBe(true);
  });

  it("puts VIP before non-VIP within a priority", () => {
    const vip = queueSortKey(t({ number: 1, vip: true }));
    const plain = queueSortKey(t({ number: 2, vip: false }));
    expect(vip < plain).toBe(true);
  });
});
