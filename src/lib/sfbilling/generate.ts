import { computeLine } from "@/lib/billing/line";
import { roundHours, roundMoney } from "@/lib/silverfang/project-billing";

/**
 * SilverFang billing generation — pure, so the preview and the persisted run come
 * from identical logic, and so the rules below can be tested rather than trusted.
 *
 * The hard part is not arithmetic, it is not billing the same hour twice. Money
 * in SilverFang arrives by four different routes and each has already been paid
 * for, or not, in a different way:
 *
 *   - Prepaid block hours were paid when the block was bought. Drawing them down
 *     bills nothing; only hours beyond the balance are overage.
 *   - Managed-services inclusions are paid by the recurring fee. Only hours past
 *     the inclusion are overage.
 *   - Fixed-fee project hours are paid by the fee, and must never be shown to the
 *     client as hours at all.
 *   - Time and materials, and time with no agreement, bills as worked.
 *
 * Every entry the generator considers is accounted for: it either lands on a line
 * or appears in `covered` with the reason it did not. Nothing is silently
 * dropped, because a dropped hour is revenue nobody ever notices is missing.
 */

export type SfLineKind =
  | "TIME"
  | "OVERAGE"
  | "RECURRING"
  | "BLOCK_PURCHASE"
  | "PROJECT_FEE"
  | "PROJECT_DEPOSIT"
  | "MANUAL";

export type AgreementType =
  | "BLOCK_TIME"
  | "MANAGED_SERVICES"
  | "MANAGED_NOC"
  | "PROJECT"
  | "TIME_AND_MATERIALS";

export interface TimeEntryInput {
  id: string;
  workDate: Date;
  hours: number;
  /** Resolved at log time — never recomputed here, so history stays history. */
  rate: number | null;
  costRate: number | null;
  billable: boolean;
  internalOnly: boolean;
  notes: string | null;
  chargeCodeId: string;
  chargeCodeName: string;
  agreementId: string | null;
  projectId: string | null;
  ticketNumber: number | null;
  ticketSummary: string | null;
}

export interface AgreementInput {
  id: string;
  name: string;
  type: AgreementType;
  billingFrequency: string | null;
  monthlyAmount: number | null;
  includedHours: number | null;
  overageRate: number | null;
  standardRate: number | null;
  startDate: Date;
  endDate: Date | null;
  /** Prepaid hours still available at the start of the period. */
  blockBalanceHours: number;
}

export interface BlockInput {
  id: string;
  agreementId: string;
  agreementName: string;
  purchasedHours: number;
  rate: number | null;
  amount: number | null;
  purchasedAt: Date;
  invoiced: boolean;
}

export interface ProjectInput {
  id: string;
  name: string;
  billingType: "TIME_AND_MATERIALS" | "FIXED_FEE";
  fixedFeeAmount: number | null;
  billingIntervalDays: number;
  startDate: Date | null;
  feeBilledThroughAt: Date | null;
  budgetAmount: number | null;
  depositPercent: number | null;
  depositAmount: number | null;
  depositInvoicedAt: Date | null;
}

export interface GeneratedSfLine {
  kind: SfLineKind;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  adjustment: number;
  subtotal: number;
  total: number;
  estimatedCost: number | null;
  chargeCodeId: string | null;
  agreementId: string | null;
  projectId: string | null;
  blockId: string | null;
  /** False when the client must never see hours behind this line. */
  hoursVisible: boolean;
  /** Entries this line consumes, with the hours taken from each. */
  timeEntries: { id: string; hours: number }[];
}

export interface CoveredEntry {
  id: string;
  hours: number;
  /** Why this entry produced no charge. Shown, never hidden. */
  reason:
    | "NOT_BILLABLE"
    | "PREPAID_BLOCK"
    | "AGREEMENT_INCLUSION"
    | "FIXED_FEE_PROJECT"
    | "NO_RATE";
}

export interface SfGenerationNote {
  severity: "info" | "warning" | "error";
  message: string;
}

export interface SfGenerationResult {
  lines: GeneratedSfLine[];
  /** Entries that were considered and produced no charge, with the reason. */
  covered: CoveredEntry[];
  notes: SfGenerationNote[];
}

export interface SfGenerateInput {
  clientName: string;
  periodStart: Date;
  /** Exclusive: the period is the half-open interval [start, end). */
  periodEnd: Date;
  timeEntries: TimeEntryInput[];
  agreements: AgreementInput[];
  blocks: BlockInput[];
  projects: ProjectInput[];
  /** Group hour lines per charge code (default) or one per ticket. */
  groupBy?: "CHARGE_CODE" | "TICKET";
}

const DAY_MS = 86_400_000;
/** Refuse to bill more than this many fixed-fee intervals in one run. */
const MAX_FEE_PERIODS = 24;

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function periodLabel(start: Date, end: Date): string {
  // The period is half-open, so the last billed day is the day before the end.
  return `${fmtDate(start)} – ${fmtDate(new Date(end.getTime() - DAY_MS))}`;
}

function buildLine(
  partial: Omit<GeneratedSfLine, "subtotal" | "total">,
): GeneratedSfLine {
  const { subtotal, total } = computeLine({
    quantity: partial.quantity,
    unitPrice: partial.unitPrice,
    discount: partial.discount,
    adjustment: partial.adjustment,
  });
  return { ...partial, subtotal, total };
}

/** Hours across a set of entries, rounded once at the end. */
function sumHours(entries: TimeEntryInput[]): number {
  return roundHours(entries.reduce((a, e) => a + e.hours, 0));
}

/**
 * Weighted average rate across entries. Used when rolling several entries onto
 * one line: the line's unit price has to reproduce the sum of the entries'
 * amounts, and an unweighted mean would not.
 */
function weightedRate(entries: TimeEntryInput[], fallback: number | null): number {
  const hours = entries.reduce((a, e) => a + e.hours, 0);
  if (hours <= 0) return fallback ?? 0;
  const value = entries.reduce((a, e) => a + e.hours * (e.rate ?? fallback ?? 0), 0);
  return roundMoney(value / hours);
}

function costOf(entries: TimeEntryInput[]): number | null {
  const known = entries.filter((e) => e.costRate != null);
  if (known.length === 0) return null;
  return roundMoney(known.reduce((a, e) => a + e.hours * (e.costRate ?? 0), 0));
}

/** A readable description for a rolled-up hours line. */
function hoursDescription(
  chargeCodeName: string,
  entries: TimeEntryInput[],
  suffix: string,
): string {
  const tickets = Array.from(
    new Set(entries.map((e) => e.ticketNumber).filter((n): n is number => n != null)),
  ).sort((a, b) => a - b);
  const ticketPart =
    tickets.length === 0
      ? ""
      : tickets.length <= 6
        ? ` (tickets ${tickets.map((n) => `#${n}`).join(", ")})`
        : ` (${tickets.length} tickets)`;
  return `${chargeCodeName}${ticketPart}${suffix}`;
}

/**
 * Whether a recurring agreement bills in this period. Monthly bills every run;
 * yearly bills only in the run whose period contains the anniversary, so a
 * yearly agreement is not charged twelve times a year.
 */
export function recurringDueInPeriod(
  agreement: Pick<AgreementInput, "billingFrequency" | "startDate">,
  periodStart: Date,
  periodEnd: Date,
): boolean {
  const freq = (agreement.billingFrequency ?? "MONTHLY").toUpperCase();
  if (freq !== "YEARLY") return true;
  // Walk the anniversary for each year the period could touch.
  for (
    let year = periodStart.getUTCFullYear() - 1;
    year <= periodEnd.getUTCFullYear() + 1;
    year += 1
  ) {
    const anniversary = new Date(
      Date.UTC(
        year,
        agreement.startDate.getUTCMonth(),
        agreement.startDate.getUTCDate(),
      ),
    );
    if (anniversary >= periodStart && anniversary < periodEnd) return true;
  }
  return false;
}

/** Whether an agreement is live at any point in the period. */
export function agreementActiveInPeriod(
  agreement: Pick<AgreementInput, "startDate" | "endDate">,
  periodStart: Date,
  periodEnd: Date,
): boolean {
  if (agreement.startDate >= periodEnd) return false;
  if (agreement.endDate && agreement.endDate < periodStart) return false;
  return true;
}

/**
 * Complete fixed-fee intervals owed as at `asOf`, counting from the watermark (or
 * the project start). Returns 0 rather than a negative when nothing is due.
 */
export function feePeriodsDue(project: ProjectInput, asOf: Date): number {
  const anchor = project.feeBilledThroughAt ?? project.startDate;
  if (!anchor) return 0;
  const days = project.billingIntervalDays > 0 ? project.billingIntervalDays : 30;
  const elapsed = (asOf.getTime() - anchor.getTime()) / DAY_MS;
  if (elapsed < days) return 0;
  return Math.floor(elapsed / days);
}

/**
 * Build the lines for one client for one period.
 *
 * Order matters: hours are apportioned against inclusions and prepaid balances
 * before anything else, because whether an hour bills depends on what has already
 * absorbed it.
 */
export function generateSfBillingLines(input: SfGenerateInput): SfGenerationResult {
  const { periodStart, periodEnd } = input;
  const lines: GeneratedSfLine[] = [];
  const covered: CoveredEntry[] = [];
  const notes: SfGenerationNote[] = [];
  const groupBy = input.groupBy ?? "CHARGE_CODE";
  const label = periodLabel(periodStart, periodEnd);

  const agreementById = new Map(input.agreements.map((a) => [a.id, a]));
  const projectById = new Map(input.projects.map((p) => [p.id, p]));

  // ---- 1. Hours -----------------------------------------------------------
  // Sorted oldest first so inclusions and prepaid balances are consumed in the
  // order the work happened — the only defensible order when only some of a
  // period's hours are covered.
  const entries = [...input.timeEntries].sort(
    (a, b) => a.workDate.getTime() - b.workDate.getTime(),
  );

  /** Remaining inclusion/prepaid capacity, drawn down as entries are apportioned. */
  const capacity = new Map<string, number>();
  for (const a of input.agreements) {
    if (a.type === "BLOCK_TIME") {
      capacity.set(a.id, Math.max(0, a.blockBalanceHours));
    } else if (a.type === "MANAGED_SERVICES" || a.type === "MANAGED_NOC") {
      capacity.set(a.id, Math.max(0, a.includedHours ?? 0));
    }
  }

  /** Entries that bill, bucketed so they can be rolled onto lines. */
  const billable = new Map<
    string,
    { key: string; kind: SfLineKind; agreementId: string | null; entries: TimeEntryInput[] }
  >();

  for (const e of entries) {
    if (!e.billable) {
      covered.push({ id: e.id, hours: e.hours, reason: "NOT_BILLABLE" });
      continue;
    }

    // A fixed-fee project's hours are paid for by the fee. They are recorded as
    // covered — never as a line — so the client cannot infer them.
    const project = e.projectId ? projectById.get(e.projectId) : undefined;
    if (project?.billingType === "FIXED_FEE") {
      covered.push({ id: e.id, hours: e.hours, reason: "FIXED_FEE_PROJECT" });
      continue;
    }

    const agreement = e.agreementId ? agreementById.get(e.agreementId) : undefined;
    let chargeableHours = e.hours;
    let kind: SfLineKind = "TIME";

    if (agreement && capacity.has(agreement.id)) {
      const left = capacity.get(agreement.id) ?? 0;
      const absorbed = Math.min(left, e.hours);
      capacity.set(agreement.id, roundHours(left - absorbed));
      chargeableHours = roundHours(e.hours - absorbed);
      if (absorbed > 0) {
        covered.push({
          id: e.id,
          hours: roundHours(absorbed),
          reason: agreement.type === "BLOCK_TIME" ? "PREPAID_BLOCK" : "AGREEMENT_INCLUSION",
        });
      }
      if (chargeableHours <= 0) continue;
      // Anything past an inclusion or a prepaid balance is overage, by definition.
      kind = "OVERAGE";
    }

    const rate =
      e.rate ??
      (kind === "OVERAGE" ? agreement?.overageRate : null) ??
      agreement?.standardRate ??
      null;
    if (rate == null || rate <= 0) {
      // No rate means no number to put on the line. Reported, not invented.
      covered.push({ id: e.id, hours: chargeableHours, reason: "NO_RATE" });
      continue;
    }

    const bucketKey =
      groupBy === "TICKET"
        ? `${kind}|${e.agreementId ?? "-"}|${e.chargeCodeId}|${e.ticketNumber ?? "none"}`
        : `${kind}|${e.agreementId ?? "-"}|${e.chargeCodeId}`;
    const bucket = billable.get(bucketKey) ?? {
      key: bucketKey,
      kind,
      agreementId: e.agreementId,
      entries: [],
    };
    // Only the chargeable slice of a partially-absorbed entry belongs on the line.
    bucket.entries.push(chargeableHours === e.hours ? e : { ...e, hours: chargeableHours });
    billable.set(bucketKey, bucket);
  }

  for (const bucket of billable.values()) {
    const first = bucket.entries[0];
    if (!first) continue;
    const agreement = bucket.agreementId ? agreementById.get(bucket.agreementId) : undefined;
    const fallback =
      bucket.kind === "OVERAGE"
        ? (agreement?.overageRate ?? agreement?.standardRate ?? null)
        : (agreement?.standardRate ?? null);
    const hours = sumHours(bucket.entries);
    const unitPrice = weightedRate(bucket.entries, fallback);
    const suffix =
      bucket.kind === "OVERAGE"
        ? ` — overage on ${agreement?.name ?? "agreement"}, ${label}`
        : ` — ${label}`;

    lines.push(
      buildLine({
        kind: bucket.kind,
        description: hoursDescription(first.chargeCodeName, bucket.entries, suffix),
        quantity: hours,
        unitPrice,
        discount: 0,
        adjustment: 0,
        estimatedCost: costOf(bucket.entries),
        chargeCodeId: first.chargeCodeId,
        agreementId: bucket.agreementId,
        projectId: null,
        blockId: null,
        hoursVisible: true,
        timeEntries: bucket.entries.map((e) => ({ id: e.id, hours: e.hours })),
      }),
    );
  }

  // ---- 2. Recurring agreement fees ---------------------------------------
  for (const a of input.agreements) {
    if (a.type !== "MANAGED_SERVICES" && a.type !== "MANAGED_NOC") continue;
    if (!agreementActiveInPeriod(a, periodStart, periodEnd)) continue;
    if (a.monthlyAmount == null || a.monthlyAmount <= 0) {
      notes.push({
        severity: "warning",
        message: `${a.name} is a recurring agreement with no amount set, so nothing was billed for it.`,
      });
      continue;
    }
    if (!recurringDueInPeriod(a, periodStart, periodEnd)) continue;

    const freq = (a.billingFrequency ?? "MONTHLY").toUpperCase();
    lines.push(
      buildLine({
        kind: "RECURRING",
        description:
          `${a.name} — ${freq === "YEARLY" ? "annual" : "monthly"} service fee, ${label}` +
          (a.includedHours != null && a.includedHours > 0
            ? ` (includes ${a.includedHours}h)`
            : ""),
        quantity: 1,
        unitPrice: roundMoney(a.monthlyAmount),
        discount: 0,
        adjustment: 0,
        estimatedCost: null,
        chargeCodeId: null,
        agreementId: a.id,
        projectId: null,
        blockId: null,
        hoursVisible: true,
        timeEntries: [],
      }),
    );
  }

  // ---- 3. Prepaid blocks bought this period ------------------------------
  for (const b of input.blocks) {
    if (b.invoiced) continue;
    if (b.purchasedAt < periodStart || b.purchasedAt >= periodEnd) continue;
    const amount = b.amount ?? (b.rate != null ? roundMoney(b.purchasedHours * b.rate) : null);
    if (amount == null || amount <= 0) {
      notes.push({
        severity: "warning",
        message:
          `The ${b.purchasedHours}h block on ${b.agreementName} has neither an amount nor a rate, ` +
          `so it could not be billed. Set one on the block.`,
      });
      continue;
    }
    lines.push(
      buildLine({
        kind: "BLOCK_PURCHASE",
        description: `${b.agreementName} — ${b.purchasedHours}h prepaid block purchased ${fmtDate(b.purchasedAt)}`,
        quantity: roundHours(b.purchasedHours),
        unitPrice: roundMoney(amount / b.purchasedHours),
        discount: 0,
        adjustment: 0,
        estimatedCost: null,
        chargeCodeId: null,
        agreementId: b.agreementId,
        projectId: null,
        blockId: b.id,
        hoursVisible: true,
        timeEntries: [],
      }),
    );
  }

  // ---- 4. Project deposits and fixed fees --------------------------------
  for (const p of input.projects) {
    // Deposit: billed once, up front, and only when there is a total to take a
    // percentage of.
    if (p.depositInvoicedAt == null && p.depositPercent != null && p.depositPercent > 0) {
      const total = p.billingType === "FIXED_FEE" ? p.fixedFeeAmount : p.budgetAmount;
      const amount =
        p.depositAmount ?? (total != null && total > 0 ? roundMoney((total * p.depositPercent) / 100) : null);
      if (amount == null || amount <= 0) {
        notes.push({
          severity: "warning",
          message:
            `${p.name} has a ${p.depositPercent}% deposit but no total to take it from, ` +
            `so the deposit was not billed.`,
        });
      } else {
        lines.push(
          buildLine({
            kind: "PROJECT_DEPOSIT",
            description: `${p.name} — ${p.depositPercent}% deposit`,
            quantity: 1,
            unitPrice: amount,
            discount: 0,
            adjustment: 0,
            estimatedCost: null,
            chargeCodeId: null,
            agreementId: null,
            projectId: p.id,
            blockId: null,
            hoursVisible: true,
            timeEntries: [],
          }),
        );
      }
    }

    if (p.billingType !== "FIXED_FEE") continue;
    if (p.fixedFeeAmount == null || p.fixedFeeAmount <= 0) {
      notes.push({
        severity: "warning",
        message: `${p.name} is fixed fee but has no fee amount, so nothing was billed for it.`,
      });
      continue;
    }
    const dueRaw = feePeriodsDue(p, periodEnd);
    if (dueRaw === 0) continue;
    const due = Math.min(dueRaw, MAX_FEE_PERIODS);
    if (dueRaw > MAX_FEE_PERIODS) {
      notes.push({
        severity: "warning",
        message:
          `${p.name} has ${dueRaw} unbilled fixed-fee periods; this run bills ${MAX_FEE_PERIODS}. ` +
          `Run billing again to catch up, or check the project's start date.`,
      });
    }
    lines.push(
      buildLine({
        kind: "PROJECT_FEE",
        description:
          `${p.name} — fixed fee` +
          (due > 1 ? ` × ${due} periods of ${p.billingIntervalDays} days` : ` (${p.billingIntervalDays} days)`),
        quantity: due,
        unitPrice: roundMoney(p.fixedFeeAmount),
        discount: 0,
        adjustment: 0,
        estimatedCost: null,
        chargeCodeId: null,
        agreementId: null,
        projectId: p.id,
        blockId: null,
        // The client bought an outcome for a price; the hours behind it stay ours.
        hoursVisible: false,
        timeEntries: [],
      }),
    );
  }

  if (lines.length === 0) {
    notes.push({
      severity: "info",
      message:
        `Nothing to bill ${input.clientName} for ${label}. ` +
        (covered.length > 0
          ? `${covered.length} time entr${covered.length === 1 ? "y was" : "ies were"} considered and covered — see below for why.`
          : `No approved, un-invoiced time or due fees fell in this period.`),
    });
  }

  const noRate = covered.filter((c) => c.reason === "NO_RATE");
  if (noRate.length > 0) {
    notes.push({
      severity: "error",
      message:
        `${noRate.length} time entr${noRate.length === 1 ? "y has" : "ies have"} no rate, so ${
          noRate.length === 1 ? "it was" : "they were"
        } left off the invoice. Set a rate rule or an agreement standard rate, then regenerate.`,
    });
  }

  return { lines, covered, notes };
}

/** Grand total of a set of generated lines. */
export function sumSfLineTotals(lines: GeneratedSfLine[]): number {
  return roundMoney(lines.reduce((a, l) => a + l.total, 0));
}

/** Hours across the lines that carry hours, for the run summary. */
export function sumSfLineHours(lines: GeneratedSfLine[]): number {
  return roundHours(
    lines
      .filter((l) => l.kind === "TIME" || l.kind === "OVERAGE")
      .reduce((a, l) => a + l.quantity, 0),
  );
}
