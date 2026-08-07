import "server-only";
import type { Prisma } from "@prisma/client";
import { BOARD_SPECS } from "@/lib/silverfang/boards";
import { prisma } from "@/lib/db";
import {
  DEFAULT_AUTO_RESPONSES,
  DEFAULT_BOARD_NAME,
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_CHARGE_CODES,
  DEFAULT_SLA_NAME,
  DEFAULT_SLA_TARGETS,
  DEFAULT_STATUSES,
} from "@/lib/silverfang/constants";
import { computeDueDates, type SlaLike } from "@/lib/silverfang/sla";
import type { BusinessCalendar } from "@/lib/silverfang/business-hours";
import { classifyTimeBand } from "@/lib/silverfang/time";
import { resolveRate, computeAmount, type RateRuleLike } from "@/lib/silverfang/rates";
import {
  pickDefaultAgreement,
  type DefaultAgreementPick,
} from "@/lib/silverfang/default-agreement";

/**
 * Server-only SilverFang services: the I/O edges around the pure logic modules.
 * Seeding, ticket numbering, SLA application and rate resolution live here so
 * the pure math in sla.ts / rates.ts / business-hours.ts stays dependency-free.
 */

/** Next ticket number, allocated atomically so numbers never collide. */
export async function nextTicketNumber(
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const row = await tx.sfCounter.upsert({
    where: { name: "ticket" },
    create: { name: "ticket", value: 1000 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}

/**
 * Ensure a usable service desk exists: a default SLA (targets + business hours),
 * a default board with a ConnectWise-like status flow, and the standard charge
 * codes. Idempotent — safe to call on every setup page load.
 */
export async function ensureSilverFangDefaults(): Promise<{
  boardId: string;
  slaId: string;
  created: boolean;
}> {
  let created = false;

  let sla = await prisma.sfSla.findUnique({ where: { name: DEFAULT_SLA_NAME } });
  if (!sla) {
    created = true;
    sla = await prisma.sfSla.create({
      data: {
        name: DEFAULT_SLA_NAME,
        description: "Default response/resolution targets measured in business hours.",
        useBusinessHours: true,
        targets: {
          create: DEFAULT_SLA_TARGETS.flatMap((t) => [
            { priority: t.priority, kind: "RESPONSE" as const, minutes: t.response },
            { priority: t.priority, kind: "RESOLUTION" as const, minutes: t.resolution },
          ]),
        },
        businessHours: {
          create: DEFAULT_BUSINESS_HOURS.weekdays.map((weekday) => ({
            weekday,
            startMinute: DEFAULT_BUSINESS_HOURS.startMinute,
            endMinute: DEFAULT_BUSINESS_HOURS.endMinute,
            timezone: DEFAULT_BUSINESS_HOURS.timezone,
          })),
        },
      },
    });
  }

  // Three boards, organised by the kind of work rather than by who does it — a
  // per-person board turns a queue into an inbox nobody else picks up from. Each is
  // created only if absent, so running setup again never disturbs an existing board
  // or the tickets on it. Every board gets its own copy of the status flow, because
  // statuses belong to a board.
  const boardsByName = new Map<string, { id: string }>();
  for (const spec of BOARD_SPECS) {
    let existing = await prisma.sfBoard.findUnique({ where: { name: spec.name } });
    if (!existing) {
      created = true;
      existing = await prisma.sfBoard.create({
        data: {
          name: spec.name,
          description: spec.description,
          sortOrder: spec.sortOrder,
          slaId: sla.id,
          statuses: {
            create: DEFAULT_STATUSES.map((s) => ({
              name: s.name,
              sortOrder: s.sortOrder,
              isDefault: s.isDefault ?? false,
              isOpen: s.isOpen,
              isClosed: s.isClosed ?? false,
              stopsSlaClock: s.stopsSlaClock ?? false,
            })),
          },
        },
      });
    }
    boardsByName.set(spec.name, existing);
  }

  // The catch-all is the one returned as "the" board, for callers that need a
  // single default — it is where work with no agreement and no project goes.
  const board = boardsByName.get(DEFAULT_BOARD_NAME)!;

  for (const c of DEFAULT_CHARGE_CODES) {
    const existing = await prisma.sfChargeCode.findUnique({ where: { code: c.code } });
    if (!existing) {
      created = true;
      await prisma.sfChargeCode.create({
        data: {
          code: c.code,
          name: c.name,
          kind: c.kind,
          billableDefault: c.billableDefault,
          defaultMultiplier: c.defaultMultiplier ?? null,
          sortOrder: c.sortOrder,
        },
      });
    }
  }

  // Auto-response templates, seeded switched OFF so setup never starts mailing
  // clients on its own. An admin enables them on SilverFang → Email.
  for (const rule of DEFAULT_AUTO_RESPONSES) {
    const existing = await prisma.sfAutoResponseRule.findUnique({ where: { name: rule.name } });
    if (!existing) {
      created = true;
      await prisma.sfAutoResponseRule.create({
        data: {
          name: rule.name,
          trigger: rule.trigger,
          audience: rule.audience,
          subjectTemplate: rule.subjectTemplate,
          bodyTemplate: rule.bodyTemplate,
          active: false,
        },
      });
    }
  }

  return { boardId: board.id, slaId: sla.id, created };
}

/** Load an SLA into the pure-logic shape (targets + business calendar). */
export async function loadSla(slaId: string | null): Promise<SlaLike | null> {
  if (!slaId) return null;
  const sla = await prisma.sfSla.findUnique({
    where: { id: slaId },
    include: { targets: true, businessHours: true, holidays: true },
  });
  if (!sla) return null;
  const calendar: BusinessCalendar = {
    windows: sla.businessHours.map((w) => ({
      weekday: w.weekday,
      startMinute: w.startMinute,
      endMinute: w.endMinute,
      timezone: w.timezone,
    })),
    holidays: sla.holidays.map((h) => h.date),
    timezone: sla.businessHours[0]?.timezone ?? DEFAULT_BUSINESS_HOURS.timezone,
  };
  return {
    useBusinessHours: sla.useBusinessHours,
    targets: sla.targets.map((t) => ({
      priority: t.priority,
      kind: t.kind,
      minutes: t.minutes,
    })),
    calendar,
  };
}

/** The business calendar to use for time banding (falls back to the default SLA). */
export async function loadDefaultCalendar(): Promise<BusinessCalendar> {
  const sla = await prisma.sfSla.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    include: { businessHours: true, holidays: true },
  });
  if (!sla) {
    return { windows: [], holidays: [], timezone: DEFAULT_BUSINESS_HOURS.timezone };
  }
  return {
    windows: sla.businessHours.map((w) => ({
      weekday: w.weekday,
      startMinute: w.startMinute,
      endMinute: w.endMinute,
      timezone: w.timezone,
    })),
    holidays: sla.holidays.map((h) => h.date),
    timezone: sla.businessHours[0]?.timezone ?? DEFAULT_BUSINESS_HOURS.timezone,
  };
}

/**
 * SLA due dates for a ticket being opened/re-prioritized. Returns nulls when the
 * board has no SLA, so callers can store "no target" honestly.
 */
export async function slaDueDatesFor(
  slaId: string | null,
  priority: "P1" | "P2" | "P3" | "P4",
  openedAt: Date,
  pausedMinutes = 0,
): Promise<{ responseDueAt: Date | null; resolutionDueAt: Date | null }> {
  const sla = await loadSla(slaId);
  if (!sla) return { responseDueAt: null, resolutionDueAt: null };
  return computeDueDates(sla, priority, openedAt, pausedMinutes);
}

export interface ResolvedRate {
  rate: number | null;
  costRate: number | null;
  amount: number | null;
  timeBand: "ANY" | "DAY" | "AFTER_HOURS" | "WEEKEND" | "HOLIDAY";
  source: string;
}

/**
 * Resolve the billing rate for a time entry: classify the time band from the
 * business calendar, then apply the rate-rule precedence with agreement/tech
 * fallbacks. Returns nulls when nothing resolves so the UI can flag it rather
 * than invent a number.
 */
export async function resolveTimeEntryRate(input: {
  clientId: string;
  chargeCodeId: string;
  agreementId?: string | null;
  userId: string;
  workedAt: Date;
  hours: number;
  billable: boolean;
}): Promise<ResolvedRate> {
  const [calendar, chargeCode, rules, agreement, tech] = await Promise.all([
    loadDefaultCalendar(),
    prisma.sfChargeCode.findUnique({ where: { id: input.chargeCodeId } }),
    prisma.sfRateRule.findMany({ where: { active: true } }),
    input.agreementId
      ? prisma.sfAgreement.findUnique({ where: { id: input.agreementId } })
      : Promise.resolve(null),
    prisma.sfTechProfile.findUnique({ where: { userId: input.userId } }),
  ]);

  const timeBand = classifyTimeBand(calendar, input.workedAt);
  if (!input.billable) {
    return { rate: null, costRate: null, amount: null, timeBand, source: "non-billable" };
  }

  const ruleLikes: RateRuleLike[] = rules.map((r) => ({
    scope: r.scope,
    clientId: r.clientId,
    agreementId: r.agreementId,
    chargeCodeId: r.chargeCodeId,
    timeBand: r.timeBand,
    fixedRate: r.fixedRate != null ? Number(r.fixedRate) : null,
    multiplier: r.multiplier != null ? Number(r.multiplier) : null,
    costRate: r.costRate != null ? Number(r.costRate) : null,
    active: r.active,
  }));

  const resolution = resolveRate({
    rules: ruleLikes,
    clientId: input.clientId,
    chargeCodeId: input.chargeCodeId,
    agreementId: input.agreementId ?? null,
    timeBand,
    techBillRate: tech?.billRate != null ? Number(tech.billRate) : null,
    agreementStandardRate:
      agreement?.standardRate != null ? Number(agreement.standardRate) : null,
    chargeCodeMultiplier:
      chargeCode?.defaultMultiplier != null ? Number(chargeCode.defaultMultiplier) : null,
  });

  return {
    rate: resolution.rate,
    costRate: resolution.costRate ?? (tech?.costRate != null ? Number(tech.costRate) : null),
    amount: computeAmount(input.hours, resolution.rate),
    timeBand,
    source: resolution.source,
  };
}

/**
 * The agreement a client's work should default to.
 *
 * Reads the client's SilverFang profile default and their live agreements, then
 * defers to `pickDefaultAgreement` for the decision. Returns null when there is
 * nothing safe to pick — which for a break-fix client is the correct answer, not
 * a failure.
 */
export async function defaultAgreementFor(
  clientId: string,
  now: Date = new Date(),
): Promise<DefaultAgreementPick | null> {
  const [profile, agreements] = await Promise.all([
    prisma.sfClientProfile.findUnique({
      where: { clientId },
      select: { defaultAgreementId: true },
    }),
    prisma.sfAgreement.findMany({
      where: { clientId },
      select: { id: true, type: true, status: true, startDate: true, endDate: true },
    }),
  ]);
  return pickDefaultAgreement(agreements, {
    profileDefaultId: profile?.defaultAgreementId ?? null,
    now,
  });
}

/** Recompute and store a ticket's actualHours from its time entries. */
export async function recomputeTicketHours(ticketId: string): Promise<void> {
  const agg = await prisma.sfTimeEntry.aggregate({
    where: { ticketId },
    _sum: { hours: true },
  });
  await prisma.sfTicket.update({
    where: { id: ticketId },
    data: { actualHours: agg._sum.hours ?? 0 },
  });
}
