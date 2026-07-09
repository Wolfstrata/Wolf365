import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/env";
import { safeEqual } from "@/lib/crypto";
import { runSync } from "@/connectors/runtime";
import { purgeOldDebugLogs } from "@/lib/debug-log";
import { safeErrorMessage } from "@/lib/redact";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { runNeonBackup, pruneExpiredBackups } from "@/lib/backup/service";
import { snapshotCurrentMonth } from "@/lib/licensing/snapshot";

// Cron jobs may run longer than the default; allow up to 5 minutes.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Vercel Cron entrypoint (scheduled in vercel.json).
 *
 * Authenticates via the CRON_SECRET bearer token that Vercel injects, then:
 *  - syncs every enabled connector (failures are isolated per connector)
 *  - purges debug logs older than the configured retention window
 *
 * Never runs without a configured + matching secret, so it cannot be triggered
 * by arbitrary callers.
 */
export async function GET(request: Request) {
  const env = getEnv();
  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.CRON_SECRET}`;
  if (!safeEqual(authHeader, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  // Defense-in-depth beyond the shared secret.
  const rl = await rateLimit(`cron:${clientIp(request)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429 });
  }

  const enabled = await prisma.connector.findMany({
    where: { enabled: true },
    select: { type: true },
  });

  const results: Record<string, unknown> = {};
  for (const { type } of enabled) {
    try {
      const r = await runSync(type, "cron");
      results[type] = { ok: true, ...r };
    } catch (err) {
      // Isolate failures so one bad connector doesn't abort the others.
      results[type] = { ok: false, error: safeErrorMessage(err) };
    }
  }

  // Refresh discrepancy exceptions after syncs (best-effort).
  let reconciled: { scanned: number; flagged: number } | { error: string };
  try {
    const { reconcileAllClients } = await import("@/lib/reconciliation/service");
    reconciled = await reconcileAllClients({ id: null, email: "cron" });
  } catch (err) {
    reconciled = { error: safeErrorMessage(err) };
  }

  const purged = await purgeOldDebugLogs(env.WOLF365_DEBUG_LOG_RETENTION_DAYS);

  // Daily database backup (Neon branch snapshot) + retention pruning.
  // Best-effort: a backup failure must not fail the whole cron.
  let backup: unknown;
  try {
    const now = new Date();
    const result = await runNeonBackup({
      trigger: "CRON",
      actor: { id: null, email: "cron" },
      now,
    });
    const pruned = await pruneExpiredBackups(now);
    backup = { ...result, pruned };
  } catch (err) {
    backup = { ok: false, error: safeErrorMessage(err) };
  }

  // M365 cost snapshot for the current month (baseline for cost-change
  // detection). Best-effort; no-ops until the snapshot table exists.
  let snapshot: unknown;
  try {
    const written = await snapshotCurrentMonth(new Date());
    snapshot =
      written == null ? { skipped: "snapshot table not present yet" } : { written };
  } catch (err) {
    snapshot = { ok: false, error: safeErrorMessage(err) };
  }

  // Weekly M365 alert digest (Mondays): renewals in 90/60/30-day windows +
  // cost changes vs last month, emailed via Resend. Best-effort; only sends
  // when RESEND_API_KEY is configured and there is something to report.
  let alerts: unknown;
  try {
    const now = new Date();
    if (now.getUTCDay() === 1) {
      const { runM365AlertDigest } = await import("@/lib/licensing/alerts");
      alerts = await runM365AlertDigest(now);
    } else {
      alerts = { skipped: "weekly digest runs on Mondays" };
    }
  } catch (err) {
    alerts = { ok: false, error: safeErrorMessage(err) };
  }

  return NextResponse.json({
    ok: true,
    synced: results,
    reconciled,
    debugLogsPurged: purged,
    backup,
    snapshot,
    alerts,
  });
}
