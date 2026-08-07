import "server-only";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { recordChanges } from "@/lib/silverfang/change-log";
import { addMonths, increaseBy, renewalPreview } from "@/lib/silverfang/renewal";

/**
 * Applying an agreement's auto-renew uplift.
 *
 * One implementation, two callers: the cron sweep that renews on the due date,
 * and the button on the agreement page for renewing early or catching up. They
 * must not diverge — a renewal that behaves differently depending on who
 * triggered it is impossible to reason about after the fact.
 *
 * Idempotency is the whole game. `lastRenewedAt` is compared against the term's
 * end date, so a term can only be renewed once no matter how many times this
 * runs — and the sub-daily cron runs it 96 times a day. Without that guard, 15%
 * would compound into 32% within half an hour.
 */

export interface RenewalOutcome {
  agreementId: string;
  agreementName: string;
  clientName: string;
  ok: boolean;
  /** Present when applied. */
  percent?: number;
  from?: number | null;
  to?: number | null;
  newEndDate?: Date;
  /** Present when not applied. */
  reason?: string;
}

type Actor = { id: string | null; email: string };

/** Load the shape `renewalPreview` needs from a stored agreement. */
function toPreviewInput(a: {
  autoRenew: boolean;
  renewalIncreasePercent: { toString(): string };
  startDate: Date;
  endDate: Date | null;
  lastRenewedAt: Date | null;
  billingFrequency: string | null;
  monthlyAmount: { toString(): string } | null;
  overageRate: { toString(): string } | null;
  standardRate: { toString(): string } | null;
}) {
  const num = (v: { toString(): string } | null) => (v != null ? Number(v) : null);
  return {
    autoRenew: a.autoRenew,
    renewalIncreasePercent: Number(a.renewalIncreasePercent),
    startDate: a.startDate,
    endDate: a.endDate,
    lastRenewedAt: a.lastRenewedAt,
    billingFrequency: a.billingFrequency,
    monthlyAmount: num(a.monthlyAmount),
    overageRate: num(a.overageRate),
    standardRate: num(a.standardRate),
  };
}

/**
 * Apply the uplift to one agreement. Raises the recurring fee by the configured
 * percentage and rolls the term forward by its own length; hourly rates are left
 * alone.
 *
 * `requireDue` is what separates the two callers. The cron passes true so it can
 * only ever act on a term that has genuinely ended. The button passes false, so a
 * human can renew early — deliberately, and with the UI saying so.
 */
export async function applyAgreementRenewal(
  agreementId: string,
  actor: Actor,
  opts: { requireDue?: boolean; asOf?: Date } = {},
): Promise<RenewalOutcome> {
  const asOf = opts.asOf ?? new Date();
  const agreement = await prisma.sfAgreement.findUnique({
    where: { id: agreementId },
    include: { client: { select: { name: true } } },
  });
  if (!agreement) {
    return {
      agreementId,
      agreementName: "(deleted)",
      clientName: "(unknown)",
      ok: false,
      reason: "That agreement no longer exists.",
    };
  }

  const base = {
    agreementId,
    agreementName: agreement.name,
    clientName: agreement.client.name,
  };

  if (!agreement.autoRenew) {
    return {
      ...base,
      ok: false,
      reason:
        "This agreement is not set to auto-renew, so there is no renewal uplift to apply. Tick auto-renew first if it should renew.",
    };
  }
  if (!agreement.endDate) {
    return {
      ...base,
      ok: false,
      reason: "This agreement has no end date, so there is no term to renew. Set an end date first.",
    };
  }

  const percent = Number(agreement.renewalIncreasePercent);
  const preview = renewalPreview(toPreviewInput(agreement), asOf);

  if (preview.alreadyRenewed) {
    return {
      ...base,
      ok: false,
      reason:
        "This term has already been renewed — applying the uplift again would compound it. The next renewal is due at the new end date.",
    };
  }
  if (opts.requireDue && !preview.due) {
    return { ...base, ok: false, reason: "The term has not ended yet." };
  }

  const monthlyBefore = agreement.monthlyAmount != null ? Number(agreement.monthlyAmount) : null;
  const monthlyAfter = increaseBy(monthlyBefore, percent);
  const newEndDate = addMonths(agreement.endDate, preview.termMonths);

  const saved = await prisma.sfAgreement.update({
    where: { id: agreementId },
    data: {
      // The old end date becomes the new start of the term, so what the term was
      // stays derivable from the dates alone.
      startDate: agreement.endDate,
      endDate: newEndDate,
      // The recurring fee only — overageRate and standardRate are untouched.
      monthlyAmount: monthlyAfter,
      lastRenewedAt: new Date(),
    },
  });

  await recordChanges({
    entity: "SfAgreement",
    entityId: agreementId,
    entityLabel: `${agreement.client.name} — ${agreement.name}`,
    actor: { id: actor.id, email: actor.email },
    before: agreement as unknown as Record<string, unknown>,
    after: saved as unknown as Record<string, unknown>,
    fields: ["startDate", "endDate", "monthlyAmount", "lastRenewedAt"],
  });
  await audit({
    action: "AGREEMENT_UPDATED",
    actorId: actor.id ?? undefined,
    actorEmail: actor.email,
    target: `sfAgreement:${agreementId}`,
    metadata: {
      renewed: true,
      automatic: opts.requireDue === true,
      percent,
      termMonths: preview.termMonths,
      monthlyFrom: monthlyBefore,
      monthlyTo: monthlyAfter,
      newEndDate: newEndDate.toISOString(),
    },
  });

  return {
    ...base,
    ok: true,
    percent,
    from: monthlyBefore,
    to: monthlyAfter,
    newEndDate,
  };
}

export interface RenewalSweepResult {
  considered: number;
  renewed: number;
  failed: number;
  outcomes: RenewalOutcome[];
}

/**
 * Renew every agreement whose term has ended and whose auto-renew is on.
 *
 * Run from the sub-daily cron, so an agreement renews on its due date without
 * anyone remembering. `autoRenew` is the consent: an agreement only enters this
 * sweep because someone ticked the box and set the percentage, and the change
 * trail plus the audit log record every application with `automatic: true` so the
 * price rise is never a mystery later.
 *
 * Bounded per run, and each agreement advances exactly one term. A badly stale
 * agreement catches up over successive runs rather than jumping several terms in
 * one transaction, which keeps every intermediate state a real one.
 */
export async function sweepAgreementRenewals(
  limit = 200,
  asOf: Date = new Date(),
): Promise<RenewalSweepResult> {
  const due = await prisma.sfAgreement.findMany({
    where: {
      autoRenew: true,
      status: "ACTIVE",
      // The term has ended. `alreadyRenewed` is checked per agreement, since it
      // compares two columns and cannot be expressed here.
      endDate: { not: null, lte: asOf },
    },
    orderBy: { endDate: "asc" },
    select: { id: true },
    take: limit,
  });

  const outcomes: RenewalOutcome[] = [];
  for (const { id } of due) {
    try {
      outcomes.push(
        await applyAgreementRenewal(
          id,
          { id: null, email: "cron@wolf365" },
          { requireDue: true, asOf },
        ),
      );
    } catch (err) {
      // One bad agreement must not stop the rest from renewing.
      outcomes.push({
        agreementId: id,
        agreementName: "(unknown)",
        clientName: "(unknown)",
        ok: false,
        reason: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const renewed = outcomes.filter((o) => o.ok).length;
  return {
    considered: due.length,
    renewed,
    // "Already renewed" and "not due" are the expected no-ops of a sweep that
    // runs every 15 minutes, so they are not counted as failures.
    failed: outcomes.filter(
      (o) => !o.ok && o.reason !== "The term has not ended yet." && !/already been renewed/.test(o.reason ?? ""),
    ).length,
    outcomes: outcomes.filter((o) => o.ok || o.reason !== "The term has not ended yet."),
  };
}
