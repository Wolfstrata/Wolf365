import "server-only";
import { prisma } from "@/lib/db";
import {
  byWorstMargin,
  profitability,
  realisation,
  techUtilisation,
  totalProfit,
  weekdayCapacity,
  type Profit,
  type Realisation,
  type TechUtilisation,
} from "@/lib/silverfang/reporting";

/**
 * Data for the service-delivery report. All arithmetic lives in `reporting.ts`;
 * this only fetches and maps, so the contested definitions stay in one tested
 * place.
 *
 * Two deliberate choices about what counts:
 *
 *  - REVENUE means billing lines on runs that were actually PUSHED (or
 *    PARTIALLY_FAILED, where some lines did reach QBO). A draft or approved run
 *    is a proposal, and counting proposals as revenue is how a report becomes
 *    something nobody trusts.
 *  - COST comes from the time entries' own `costRate`, resolved when the hour was
 *    logged, not from today's rate card. Recomputing history when a rate changes
 *    would silently restate last quarter.
 *
 * Revenue is matched to the period by invoice date and cost by work date, which
 * are not the same window. That is normal for a service business and is stated on
 * the page rather than papered over.
 */

/** Runs whose lines represent money actually invoiced. */
const INVOICED_RUN_STATUSES = ["PUSHED", "PARTIALLY_FAILED"] as const;

/** Time that counts as delivered work: anything an approver has seen or billed. */
const DELIVERED_TIME_STATUSES = ["APPROVED", "INVOICED"] as const;

export interface ServiceReport {
  periodStart: Date;
  periodEnd: Date;
  techs: TechUtilisation[];
  realisation: Realisation;
  /** Profitability per client, worst margin first. */
  clients: Profit[];
  /** Profitability per agreement, worst margin first. */
  agreements: Profit[];
  clientTotal: Profit;
  /** Hours logged in the period that no approver has seen yet. */
  unapprovedHours: number;
  /**
   * Billable hours with no rate resolved. These are the alarming ones: an hour
   * nobody priced was not a decision to give it away.
   */
  unratedHours: number;
  hoursPerDay: number;
}

function num(value: unknown): number {
  if (value == null) return 0;
  // Prisma Decimal → Number once, at the boundary.
  return typeof value === "number" ? value : Number(value);
}

export async function serviceReport(
  periodStart: Date,
  periodEnd: Date,
  hoursPerDay = 8,
): Promise<ServiceReport> {
  const workWindow = { gte: periodStart, lt: periodEnd };

  const [entries, lines] = await Promise.all([
    prisma.sfTimeEntry.findMany({
      where: { workDate: workWindow },
      select: {
        userId: true,
        hours: true,
        billable: true,
        rate: true,
        costRate: true,
        amount: true,
        status: true,
        agreementId: true,
        agreement: { select: { id: true, name: true, clientId: true } },
        ticket: { select: { clientId: true } },
        user: { select: { name: true, email: true } },
      },
      take: 50_000,
    }),
    prisma.sfBillingLine.findMany({
      where: {
        run: {
          status: { in: [...INVOICED_RUN_STATUSES] },
          invoiceDate: workWindow,
        },
      },
      select: {
        total: true,
        estimatedCost: true,
        quantity: true,
        kind: true,
        agreementId: true,
        agreement: { select: { id: true, name: true } },
        run: { select: { clientId: true, client: { select: { name: true } } } },
      },
      take: 50_000,
    }),
  ]);

  // --- Utilisation, per tech ------------------------------------------------
  const capacity = weekdayCapacity(periodStart, periodEnd, hoursPerDay);
  const perTech = new Map<
    string,
    { name: string; billable: number; nonBillable: number; worked: number; cost: number }
  >();
  let unapprovedHours = 0;
  let unratedHours = 0;
  let workedValue = 0;

  for (const e of entries) {
    const hours = num(e.hours);
    const cost = num(e.costRate) * hours;
    const value = e.amount != null ? num(e.amount) : num(e.rate) * hours;

    const bucket = perTech.get(e.userId) ?? {
      name: e.user.name ?? e.user.email ?? "Unknown",
      billable: 0,
      nonBillable: 0,
      worked: 0,
      cost: 0,
    };
    if (e.billable) {
      bucket.billable += hours;
      bucket.worked += value;
      workedValue += value;
      if (num(e.rate) === 0 && num(e.amount) === 0) unratedHours += hours;
    } else {
      bucket.nonBillable += hours;
    }
    bucket.cost += cost;
    perTech.set(e.userId, bucket);

    if (!(DELIVERED_TIME_STATUSES as readonly string[]).includes(e.status)) {
      unapprovedHours += hours;
    }
  }

  const techs = [...perTech.entries()]
    .map(([userId, b]) =>
      techUtilisation({
        userId,
        name: b.name,
        billableHours: b.billable,
        nonBillableHours: b.nonBillable,
        workedValue: b.worked,
        cost: b.cost,
        // Every tech gets the same period capacity. Per-person schedules are not
        // modelled, so pretending otherwise would invent precision.
        capacityHours: capacity,
      }),
    )
    // Busiest first: the report is read top-down.
    .sort((a, b) => b.billableHours - a.billableHours);

  // --- Realisation ----------------------------------------------------------
  // Only the lines that represent charged hours count as "billed value" here;
  // a recurring fee is revenue but is not payment for a specific hour.
  const HOURLY_KINDS = new Set(["TIME", "OVERAGE"]);
  const billedValue = lines
    .filter((l) => HOURLY_KINDS.has(l.kind))
    .reduce((a, l) => a + num(l.total), 0);

  // --- Profitability, per client and per agreement --------------------------
  const clientRevenue = new Map<string, { name: string; revenue: number }>();
  const agreementRevenue = new Map<string, { name: string; revenue: number }>();
  for (const l of lines) {
    const clientId = l.run.clientId;
    const c = clientRevenue.get(clientId) ?? { name: l.run.client.name, revenue: 0 };
    c.revenue += num(l.total);
    clientRevenue.set(clientId, c);

    if (l.agreement) {
      const a = agreementRevenue.get(l.agreement.id) ?? { name: l.agreement.name, revenue: 0 };
      a.revenue += num(l.total);
      agreementRevenue.set(l.agreement.id, a);
    }
  }

  const clientCost = new Map<string, { cost: number; hours: number }>();
  const agreementCost = new Map<string, { name: string; cost: number; hours: number }>();
  for (const e of entries) {
    const hours = num(e.hours);
    const cost = num(e.costRate) * hours;
    // An entry reaches a client through its agreement, else through its ticket.
    // One with neither is real work we cannot attribute, so it is left out of the
    // per-client table rather than assigned to a guess.
    const clientId = e.agreement?.clientId ?? e.ticket?.clientId ?? null;
    if (clientId) {
      const c = clientCost.get(clientId) ?? { cost: 0, hours: 0 };
      c.cost += cost;
      c.hours += hours;
      clientCost.set(clientId, c);
    }
    if (e.agreement) {
      const a = agreementCost.get(e.agreement.id) ?? {
        name: e.agreement.name,
        cost: 0,
        hours: 0,
      };
      a.cost += cost;
      a.hours += hours;
      agreementCost.set(e.agreement.id, a);
    }
  }

  // Union of both sides: a client with revenue and no hours, or hours and no
  // revenue, is exactly what this table exists to show.
  const clientIds = new Set([...clientRevenue.keys(), ...clientCost.keys()]);
  const clients = byWorstMargin(
    [...clientIds].map((id) =>
      profitability({
        id,
        name: clientRevenue.get(id)?.name ?? "(no invoice this period)",
        revenue: clientRevenue.get(id)?.revenue ?? 0,
        cost: clientCost.get(id)?.cost ?? 0,
        hours: clientCost.get(id)?.hours ?? 0,
      }),
    ),
  );

  const agreementIds = new Set([...agreementRevenue.keys(), ...agreementCost.keys()]);
  const agreements = byWorstMargin(
    [...agreementIds].map((id) =>
      profitability({
        id,
        name: agreementRevenue.get(id)?.name ?? agreementCost.get(id)?.name ?? "Agreement",
        revenue: agreementRevenue.get(id)?.revenue ?? 0,
        cost: agreementCost.get(id)?.cost ?? 0,
        hours: agreementCost.get(id)?.hours ?? 0,
      }),
    ),
  );

  // Names for clients that only appear on the cost side.
  const missingNames = clients.filter((c) => c.name === "(no invoice this period)");
  if (missingNames.length > 0) {
    const named = await prisma.client.findMany({
      where: { id: { in: missingNames.map((c) => c.id) } },
      select: { id: true, name: true },
    });
    const lookup = new Map(named.map((n) => [n.id, n.name]));
    for (const row of clients) {
      const name = lookup.get(row.id);
      if (name) row.name = name;
    }
  }

  return {
    periodStart,
    periodEnd,
    techs,
    realisation: realisation({
      workedValue,
      billedValue,
      coveredHours: { unrated: unratedHours },
    }),
    clients,
    agreements,
    clientTotal: totalProfit(clients),
    unapprovedHours,
    unratedHours,
    hoursPerDay,
  };
}
