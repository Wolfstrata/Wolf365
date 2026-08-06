import "server-only";
import { prisma } from "@/lib/db";
import { safeErrorMessage } from "@/lib/redact";
import { evaluateTarget } from "@/lib/silverfang/sla";
import { loadSla } from "@/lib/silverfang/service";
import { runAutoResponses } from "@/lib/silverfang/auto-response";

/**
 * Mark SLA breaches on open tickets.
 *
 * Due dates are computed when a ticket is opened, but nothing notices when one
 * passes — so a breach was only ever visible to whoever happened to look. This
 * runs on the sub-daily cron and flips the stored flags once, then fires the
 * SLA_BREACHED auto-responses.
 *
 * Idempotent: a ticket already flagged is skipped, so the alert is sent once
 * rather than every fifteen minutes.
 */

export interface SweepResult {
  scanned: number;
  responseBreaches: number;
  resolutionBreaches: number;
  error?: string;
}

export async function sweepSlaBreaches(limit = 500): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, responseBreaches: 0, resolutionBreaches: 0 };
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
