import "server-only";
import { prisma } from "@/lib/db";
import { safeErrorMessage } from "@/lib/redact";
import { evaluateTarget } from "@/lib/silverfang/sla";
import { loadSla } from "@/lib/silverfang/service";
import { runAutoResponses } from "@/lib/silverfang/auto-response";
import { atRiskNote, shouldWarnAtRisk } from "@/lib/silverfang/escalation";

/**
 * Warn on SLA targets that are about to be missed, and mark the ones that were.
 *
 * Due dates are computed when a ticket is opened, but nothing notices when one
 * passes — so a breach was only ever visible to whoever happened to look. This
 * runs on the sub-daily cron and flips the stored flags once, then fires the
 * matching auto-responses.
 *
 * The at-risk pass is the half that can still change the outcome: a breach alert
 * is an obituary, and by the time it fires the thing it warns about has happened.
 * An at-risk warning goes out while the target can still be met.
 *
 * Idempotent throughout: a ticket already flagged or already warned is skipped, so
 * each alert is sent once rather than every fifteen minutes.
 */

export interface SweepResult {
  scanned: number;
  responseBreaches: number;
  resolutionBreaches: number;
  /** At-risk warnings raised this pass, per target. */
  responseAtRisk: number;
  resolutionAtRisk: number;
  error?: string;
}

export async function sweepSlaBreaches(limit = 500): Promise<SweepResult> {
  const result: SweepResult = {
    scanned: 0,
    responseBreaches: 0,
    resolutionBreaches: 0,
    responseAtRisk: 0,
    resolutionAtRisk: 0,
  };
  try {
    const tickets = await prisma.sfTicket.findMany({
      where: {
        status: { isClosed: false },
        slaId: { not: null },
        // Only tickets with an unbreached target left to check.
        OR: [{ slaResponseBreached: false }, { slaResolutionBreached: false }],
      },
      orderBy: { openedAt: "asc" },
      take: limit,
      select: {
        id: true,
        priority: true,
        slaId: true,
        openedAt: true,
        slaPausedMinutes: true,
        firstRespondedAt: true,
        resolvedAt: true,
        slaResponseBreached: true,
        slaResolutionBreached: true,
        slaResponseAtRiskAt: true,
        slaResolutionAtRiskAt: true,
      },
    });
    result.scanned = tickets.length;

    const slaCache = new Map<string, Awaited<ReturnType<typeof loadSla>>>();
    const now = new Date();

    for (const t of tickets) {
      if (!t.slaId) continue;
      if (!slaCache.has(t.slaId)) slaCache.set(t.slaId, await loadSla(t.slaId));
      const sla = slaCache.get(t.slaId) ?? null;
      if (!sla) continue;

      const opts = { pausedMinutes: t.slaPausedMinutes };
      const response = t.slaResponseBreached
        ? null
        : evaluateTarget(sla, t.priority, "RESPONSE", t.openedAt, now, {
            ...opts,
            metAt: t.firstRespondedAt,
          });
      const resolution = t.slaResolutionBreached
        ? null
        : evaluateTarget(sla, t.priority, "RESOLUTION", t.openedAt, now, {
            ...opts,
            metAt: t.resolvedAt,
          });

      const responseBreached = response?.breached === true && t.firstRespondedAt == null;
      const resolutionBreached = resolution?.breached === true && t.resolvedAt == null;

      // At-risk first, and only for a target that has NOT just breached — warning
      // and breaching in the same pass would send two alerts about one target.
      const warnResponse =
        !responseBreached &&
        response != null &&
        t.firstRespondedAt == null &&
        shouldWarnAtRisk(response, t.slaResponseAtRiskAt);
      const warnResolution =
        !resolutionBreached &&
        resolution != null &&
        t.resolvedAt == null &&
        shouldWarnAtRisk(resolution, t.slaResolutionAtRiskAt);

      if (warnResponse || warnResolution) {
        await prisma.$transaction(async (tx) => {
          await tx.sfTicket.update({
            where: { id: t.id },
            data: {
              ...(warnResponse ? { slaResponseAtRiskAt: now } : {}),
              ...(warnResolution ? { slaResolutionAtRiskAt: now } : {}),
            },
          });
          if (warnResponse) {
            await tx.sfSlaEvent.create({
              data: {
                ticketId: t.id,
                kind: "AT_RISK",
                targetKind: "RESPONSE",
                note: atRiskNote("RESPONSE", response!.remainingMinutes ?? 0),
              },
            });
          }
          if (warnResolution) {
            await tx.sfSlaEvent.create({
              data: {
                ticketId: t.id,
                kind: "AT_RISK",
                targetKind: "RESOLUTION",
                note: atRiskNote("RESOLUTION", resolution!.remainingMinutes ?? 0),
              },
            });
          }
        });
        if (warnResponse) result.responseAtRisk += 1;
        if (warnResolution) result.resolutionAtRisk += 1;
        // Internal only, enforced in runAutoResponses by trigger — a client must
        // never be automatically told we are about to miss their SLA.
        await runAutoResponses("SLA_AT_RISK", t.id);
      }

      if (!responseBreached && !resolutionBreached) continue;

      await prisma.$transaction(async (tx) => {
        await tx.sfTicket.update({
          where: { id: t.id },
          data: {
            ...(responseBreached ? { slaResponseBreached: true } : {}),
            ...(resolutionBreached ? { slaResolutionBreached: true } : {}),
          },
        });
        if (responseBreached) {
          await tx.sfSlaEvent.create({
            data: {
              ticketId: t.id,
              kind: "BREACHED",
              targetKind: "RESPONSE",
              note: "Response target passed with no client-visible reply",
            },
          });
        }
        if (resolutionBreached) {
          await tx.sfSlaEvent.create({
            data: {
              ticketId: t.id,
              kind: "BREACHED",
              targetKind: "RESOLUTION",
              note: "Resolution target passed while still open",
            },
          });
        }
      });

      if (responseBreached) result.responseBreaches += 1;
      if (resolutionBreached) result.resolutionBreaches += 1;

      // Best-effort: an alert that can't send must not stop the sweep.
      await runAutoResponses("SLA_BREACHED", t.id);
    }
    return result;
  } catch (err) {
    result.error = safeErrorMessage(err);
    return result;
  }
}
