import { describe, expect, it } from "vitest";
import {
  agreementActiveInPeriod,
  feePeriodsDue,
  generateSfBillingLines,
  recurringDueInPeriod,
  sumSfLineHours,
  sumSfLineTotals,
  type AgreementInput,
  type ProjectInput,
  type SfGenerateInput,
  type TimeEntryInput,
} from "./generate";

const PERIOD_START = new Date("2026-07-01T00:00:00Z");
const PERIOD_END = new Date("2026-08-01T00:00:00Z");

function entry(over: Partial<TimeEntryInput> = {}): TimeEntryInput {
  return {
    id: "te1",
    workDate: new Date("2026-07-10T00:00:00Z"),
    hours: 2,
    rate: 150,
    costRate: 60,
    billable: true,
    internalOnly: false,
    notes: null,
    chargeCodeId: "cc-work",
    chargeCodeName: "Remote support",
    agreementId: null,
    projectId: null,
    ticketNumber: 1042,
    ticketSummary: "Mailbox broken",
    ...over,
  };
}

function agreement(over: Partial<AgreementInput> = {}): AgreementInput {
  return {
    id: "ag1",
    name: "Managed Services",
    type: "MANAGED_SERVICES",
    billingFrequency: "MONTHLY",
    monthlyAmount: 2_000,
    includedHours: 5,
    overageRate: 175,
    standardRate: 150,
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: null,
    blockBalanceHours: 0,
    ...over,
  };
}

function project(over: Partial<ProjectInput> = {}): ProjectInput {
  return {
    id: "pr1",
    name: "Server refresh",
    billingType: "TIME_AND_MATERIALS",
    fixedFeeAmount: null,
    billingIntervalDays: 30,
    startDate: new Date("2026-06-01T00:00:00Z"),
    feeBilledThroughAt: null,
    budgetAmount: 20_000,
    depositPercent: null,
    depositAmount: null,
    depositInvoicedAt: null,
    ...over,
  };
}

function run(over: Partial<SfGenerateInput> = {}): SfGenerateInput {
  return {
    clientName: "Acme Ltd",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    timeEntries: [],
    agreements: [],
    blocks: [],
    projects: [],
    ...over,
  };
}

describe("time and materials hours", () => {
  it("bills billable hours with no agreement at the logged rate", () => {
    const r = generateSfBillingLines(run({ timeEntries: [entry()] }));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!).toMatchObject({
      kind: "TIME",
      quantity: 2,
      unitPrice: 150,
      total: 300,
      estimatedCost: 120,
      hoursVisible: true,
    });
    expect(r.lines[0]!.timeEntries).toEqual([{ id: "te1", hours: 2 }]);
    expect(r.lines[0]!.description).toContain("#1042");
  });

  it("rolls entries on the same charge code onto one line", () => {
    const r = generateSfBillingLines(
      run({
        timeEntries: [
          entry({ id: "a", hours: 2, ticketNumber: 1 }),
          entry({ id: "b", hours: 3, ticketNumber: 2 }),
        ],
      }),
    );
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.quantity).toBe(5);
    expect(r.lines[0]!.total).toBe(750);
    expect(r.lines[0]!.timeEntries).toHaveLength(2);
  });

  it("uses a weighted rate so the line reproduces the entries' value", () => {
    const r = generateSfBillingLines(
      run({
        timeEntries: [
          entry({ id: "a", hours: 1, rate: 100 }),
          entry({ id: "b", hours: 3, rate: 200 }),
        ],
      }),
    );
    // 1×100 + 3×200 = 700 over 4h = 175/h
    expect(r.lines[0]!.unitPrice).toBe(175);
    expect(r.lines[0]!.total).toBe(700);
  });

  it("splits per ticket when asked", () => {
    const r = generateSfBillingLines(
      run({
        groupBy: "TICKET",
        timeEntries: [entry({ id: "a", ticketNumber: 1 }), entry({ id: "b", ticketNumber: 2 })],
      }),
    );
    expect(r.lines).toHaveLength(2);
  });

  it("counts a non-billable entry as covered rather than dropping it", () => {
    const r = generateSfBillingLines(run({ timeEntries: [entry({ billable: false })] }));
    expect(r.lines).toHaveLength(0);
    expect(r.covered).toEqual([{ id: "te1", hours: 2, reason: "NOT_BILLABLE" }]);
  });

  it("reports an entry with no rate instead of inventing one", () => {
    const r = generateSfBillingLines(run({ timeEntries: [entry({ rate: null })] }));
    expect(r.lines).toHaveLength(0);
    expect(r.covered[0]!.reason).toBe("NO_RATE");
    expect(r.notes.some((n) => n.severity === "error" && /no rate/.test(n.message))).toBe(true);
  });
});

describe("managed-services inclusions", () => {
  it("absorbs included hours and bills only the overage, at the overage rate", () => {
    const r = generateSfBillingLines(
      run({
        agreements: [agreement({ includedHours: 5 })],
        timeEntries: [entry({ id: "a", hours: 8, agreementId: "ag1", rate: null })],
      }),
    );
    const overage = r.lines.find((l) => l.kind === "OVERAGE");
    expect(overage).toMatchObject({ quantity: 3, unitPrice: 175, total: 525 });
    expect(r.covered).toEqual([{ id: "a", hours: 5, reason: "AGREEMENT_INCLUSION" }]);
  });

  it("bills nothing for hours entirely within the inclusion", () => {
    const r = generateSfBillingLines(
      run({
        agreements: [agreement({ includedHours: 10 })],
        timeEntries: [entry({ id: "a", hours: 4, agreementId: "ag1" })],
      }),
    );
    expect(r.lines.filter((l) => l.kind === "OVERAGE" || l.kind === "TIME")).toHaveLength(0);
    expect(r.covered[0]).toEqual({ id: "a", hours: 4, reason: "AGREEMENT_INCLUSION" });
  });

  it("consumes the inclusion oldest-work-first", () => {
    const r = generateSfBillingLines(
      run({
        agreements: [agreement({ includedHours: 3 })],
        timeEntries: [
          entry({ id: "late", hours: 2, workDate: new Date("2026-07-20T00:00:00Z"), agreementId: "ag1" }),
          entry({ id: "early", hours: 2, workDate: new Date("2026-07-02T00:00:00Z"), agreementId: "ag1" }),
        ],
      }),
    );
    // 'early' is fully covered; 'late' is covered for 1h and bills 1h.
    const coveredEarly = r.covered.find((c) => c.id === "early");
    expect(coveredEarly?.hours).toBe(2);
    const overage = r.lines.find((l) => l.kind === "OVERAGE");
    expect(overage?.quantity).toBe(1);
    expect(overage?.timeEntries).toEqual([{ id: "late", hours: 1 }]);
  });

  it("bills the recurring fee once per monthly period", () => {
    const r = generateSfBillingLines(run({ agreements: [agreement()] }));
    const rec = r.lines.filter((l) => l.kind === "RECURRING");
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ quantity: 1, unitPrice: 2_000, total: 2_000 });
    expect(rec[0]!.description).toContain("includes 5h");
  });

  it("warns rather than billing zero when a recurring agreement has no amount", () => {
    const r = generateSfBillingLines(run({ agreements: [agreement({ monthlyAmount: null })] }));
    expect(r.lines.filter((l) => l.kind === "RECURRING")).toHaveLength(0);
    expect(r.notes.some((n) => /no amount set/.test(n.message))).toBe(true);
  });

  it("does not bill an agreement that ended before the period", () => {
    const r = generateSfBillingLines(
      run({ agreements: [agreement({ endDate: new Date("2026-06-15T00:00:00Z") })] }),
    );
    expect(r.lines).toHaveLength(0);
  });
});

describe("block time", () => {
  it("bills nothing for hours drawn from a prepaid balance", () => {
    const r = generateSfBillingLines(
      run({
        agreements: [
          agreement({ id: "bt", type: "BLOCK_TIME", monthlyAmount: null, blockBalanceHours: 10 }),
        ],
        timeEntries: [entry({ id: "a", hours: 6, agreementId: "bt" })],
      }),
    );
    expect(r.lines).toHaveLength(0);
    expect(r.covered).toEqual([{ id: "a", hours: 6, reason: "PREPAID_BLOCK" }]);
  });

  it("bills only the hours beyond the prepaid balance", () => {
    const r = generateSfBillingLines(
      run({
        agreements: [
          agreement({
            id: "bt",
            type: "BLOCK_TIME",
            monthlyAmount: null,
            blockBalanceHours: 4,
            overageRate: 200,
          }),
        ],
        timeEntries: [entry({ id: "a", hours: 6, agreementId: "bt", rate: null })],
      }),
    );
    const overage = r.lines.find((l) => l.kind === "OVERAGE");
    expect(overage).toMatchObject({ quantity: 2, unitPrice: 200, total: 400 });
    expect(r.covered).toEqual([{ id: "a", hours: 4, reason: "PREPAID_BLOCK" }]);
  });

  it("bills a block bought in the period, once", () => {
    const r = generateSfBillingLines(
      run({
        blocks: [
          {
            id: "b1",
            agreementId: "bt",
            agreementName: "Block Time 2026",
            purchasedHours: 40,
            rate: 150,
            amount: 6_000,
            purchasedAt: new Date("2026-07-05T00:00:00Z"),
            invoiced: false,
          },
        ],
      }),
    );
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!).toMatchObject({
      kind: "BLOCK_PURCHASE",
      quantity: 40,
      unitPrice: 150,
      total: 6_000,
      blockId: "b1",
    });
  });

  it("skips a block already invoiced, and one bought outside the period", () => {
    const base = {
      id: "b1",
      agreementId: "bt",
      agreementName: "Block",
      purchasedHours: 10,
      rate: 100,
      amount: 1_000,
      purchasedAt: new Date("2026-07-05T00:00:00Z"),
      invoiced: true,
    };
    expect(generateSfBillingLines(run({ blocks: [base] })).lines).toHaveLength(0);
    expect(
      generateSfBillingLines(
        run({
          blocks: [{ ...base, invoiced: false, purchasedAt: new Date("2026-06-05T00:00:00Z") }],
        }),
      ).lines,
    ).toHaveLength(0);
  });

  it("warns when a block has neither an amount nor a rate", () => {
    const r = generateSfBillingLines(
      run({
        blocks: [
          {
            id: "b1",
            agreementId: "bt",
            agreementName: "Block",
            purchasedHours: 10,
            rate: null,
            amount: null,
            purchasedAt: new Date("2026-07-05T00:00:00Z"),
            invoiced: false,
          },
        ],
      }),
    );
    expect(r.lines).toHaveLength(0);
    expect(r.notes.some((n) => /neither an amount nor a rate/.test(n.message))).toBe(true);
  });
});

describe("fixed-fee projects", () => {
  it("never puts a fixed-fee project's hours on a line", () => {
    const r = generateSfBillingLines(
      run({
        projects: [project({ billingType: "FIXED_FEE", fixedFeeAmount: 9_000 })],
        timeEntries: [entry({ id: "a", hours: 12, projectId: "pr1" })],
      }),
    );
    expect(r.lines.some((l) => l.kind === "TIME" || l.kind === "OVERAGE")).toBe(false);
    expect(r.covered).toEqual([{ id: "a", hours: 12, reason: "FIXED_FEE_PROJECT" }]);
    // And the fee line must not advertise hours.
    const fee = r.lines.find((l) => l.kind === "PROJECT_FEE");
    expect(fee?.hoursVisible).toBe(false);
    expect(fee?.description).not.toMatch(/\bhours?\b/i);
  });

  it("bills one fee per complete interval owed", () => {
    const r = generateSfBillingLines(
      run({
        projects: [
          project({
            billingType: "FIXED_FEE",
            fixedFeeAmount: 3_000,
            startDate: new Date("2026-05-01T00:00:00Z"),
            billingIntervalDays: 30,
          }),
        ],
      }),
    );
    const fee = r.lines.find((l) => l.kind === "PROJECT_FEE");
    // 2026-05-01 → 2026-08-01 is 92 days = 3 complete 30-day intervals.
    expect(fee?.quantity).toBe(3);
    expect(fee?.total).toBe(9_000);
  });

  it("counts from the watermark, so a billed period is not billed again", () => {
    const r = generateSfBillingLines(
      run({
        projects: [
          project({
            billingType: "FIXED_FEE",
            fixedFeeAmount: 3_000,
            startDate: new Date("2026-05-01T00:00:00Z"),
            feeBilledThroughAt: new Date("2026-07-05T00:00:00Z"),
          }),
        ],
      }),
    );
    // Only 27 days since the watermark — no complete interval yet.
    expect(r.lines.some((l) => l.kind === "PROJECT_FEE")).toBe(false);
  });

  it("warns when a fixed-fee project has no fee", () => {
    const r = generateSfBillingLines(
      run({ projects: [project({ billingType: "FIXED_FEE", fixedFeeAmount: null })] }),
    );
    expect(r.notes.some((n) => /no fee amount/.test(n.message))).toBe(true);
  });
});

describe("project deposits", () => {
  it("bills an uninvoiced deposit as a percentage of the total", () => {
    const r = generateSfBillingLines(
      run({ projects: [project({ depositPercent: 25, budgetAmount: 20_000 })] }),
    );
    const dep = r.lines.find((l) => l.kind === "PROJECT_DEPOSIT");
    expect(dep).toMatchObject({ quantity: 1, unitPrice: 5_000, total: 5_000, projectId: "pr1" });
  });

  it("uses the frozen amount when one was stored", () => {
    const r = generateSfBillingLines(
      run({
        projects: [project({ depositPercent: 25, budgetAmount: 40_000, depositAmount: 5_000 })],
      }),
    );
    expect(r.lines.find((l) => l.kind === "PROJECT_DEPOSIT")?.total).toBe(5_000);
  });

  it("does not bill a deposit twice", () => {
    const r = generateSfBillingLines(
      run({
        projects: [
          project({
            depositPercent: 25,
            budgetAmount: 20_000,
            depositInvoicedAt: new Date("2026-06-01T00:00:00Z"),
          }),
        ],
      }),
    );
    expect(r.lines.some((l) => l.kind === "PROJECT_DEPOSIT")).toBe(false);
  });

  it("warns rather than guessing when there is no total", () => {
    const r = generateSfBillingLines(
      run({ projects: [project({ depositPercent: 25, budgetAmount: null })] }),
    );
    expect(r.lines.some((l) => l.kind === "PROJECT_DEPOSIT")).toBe(false);
    expect(r.notes.some((n) => /no total to take it from/.test(n.message))).toBe(true);
  });
});

describe("empty runs", () => {
  it("explains an empty run instead of showing a blank page", () => {
    const r = generateSfBillingLines(run());
    expect(r.lines).toHaveLength(0);
    expect(r.notes[0]!.severity).toBe("info");
    expect(r.notes[0]!.message).toContain("Acme Ltd");
  });

  it("says how many entries were covered when nothing bills", () => {
    const r = generateSfBillingLines(run({ timeEntries: [entry({ billable: false })] }));
    expect(r.notes[0]!.message).toMatch(/1 time entry was considered and covered/);
  });
});

describe("recurringDueInPeriod", () => {
  it("is always due monthly", () => {
    expect(
      recurringDueInPeriod(
        { billingFrequency: "MONTHLY", startDate: new Date("2026-01-15T00:00:00Z") },
        PERIOD_START,
        PERIOD_END,
      ),
    ).toBe(true);
    expect(
      recurringDueInPeriod(
        { billingFrequency: null, startDate: new Date("2026-01-15T00:00:00Z") },
        PERIOD_START,
        PERIOD_END,
      ),
    ).toBe(true);
  });

  it("is due yearly only in the anniversary period", () => {
    const july = { billingFrequency: "YEARLY", startDate: new Date("2025-07-14T00:00:00Z") };
    const march = { billingFrequency: "YEARLY", startDate: new Date("2025-03-14T00:00:00Z") };
    expect(recurringDueInPeriod(july, PERIOD_START, PERIOD_END)).toBe(true);
    expect(recurringDueInPeriod(march, PERIOD_START, PERIOD_END)).toBe(false);
  });
});

describe("agreementActiveInPeriod", () => {
  it("excludes agreements starting after or ending before the period", () => {
    expect(
      agreementActiveInPeriod(
        { startDate: new Date("2026-09-01T00:00:00Z"), endDate: null },
        PERIOD_START,
        PERIOD_END,
      ),
    ).toBe(false);
    expect(
      agreementActiveInPeriod(
        { startDate: new Date("2025-01-01T00:00:00Z"), endDate: new Date("2026-06-01T00:00:00Z") },
        PERIOD_START,
        PERIOD_END,
      ),
    ).toBe(false);
    expect(
      agreementActiveInPeriod(
        { startDate: new Date("2026-07-15T00:00:00Z"), endDate: null },
        PERIOD_START,
        PERIOD_END,
      ),
    ).toBe(true);
  });
});

describe("feePeriodsDue", () => {
  it("is zero before the first interval completes, and with no anchor", () => {
    expect(feePeriodsDue(project({ startDate: PERIOD_START }), PERIOD_START)).toBe(0);
    expect(feePeriodsDue(project({ startDate: null }), PERIOD_END)).toBe(0);
  });

  it("falls back to 30 days on a nonsense interval", () => {
    expect(
      feePeriodsDue(
        project({ startDate: new Date("2026-05-01T00:00:00Z"), billingIntervalDays: 0 }),
        PERIOD_END,
      ),
    ).toBe(3);
  });
});

describe("totals", () => {
  it("sums line totals and hours", () => {
    const r = generateSfBillingLines(
      run({
        agreements: [agreement()],
        timeEntries: [entry({ id: "a", hours: 2, agreementId: null })],
      }),
    );
    expect(sumSfLineTotals(r.lines)).toBe(2_300);
    // Only the hours lines count towards hours; the recurring fee is not hours.
    expect(sumSfLineHours(r.lines)).toBe(2);
  });
});
