import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/env";
import { safeEqual } from "@/lib/crypto";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { safeErrorMessage } from "@/lib/redact";
import { pollAllMailboxes } from "@/lib/silverfang/email-ingest";
import { sweepSlaBreaches } from "@/lib/silverfang/sla-sweep";

// Mail polling is quick, but a backlog on first run can take a while.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * SilverFang sub-daily cron (scheduled in vercel.json, every 15 minutes).
 *
 * Separate from the daily /api/cron because ticket email has to be picked up in
 * minutes, not once a day. Authenticated with the same CRON_SECRET, and does
 * nothing at all without it.
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
  if (!safeEqual(authHeader, `Bearer ${env.CRON_SECRET}`)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const rl = await rateLimit(`cron-sf:${clientIp(request)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429 });
  }

  // SLA breaches are swept regardless of mail, since due dates pass whether or
  // not a mailbox is configured.
  const sla = await sweepSlaBreaches(500);

  const mailboxes = await prisma.sfMailbox.count({
    where: { active: true, inbound: true, provider: "GRAPH" },
  });
  if (mailboxes === 0) {
    return NextResponse.json({
      ok: true,
      sla,
      mail: { skipped: "No pollable inbound mailbox is configured" },
    });
  }

  try {
    const results = await pollAllMailboxes(25);
    return NextResponse.json({
      ok: results.every((r) => r.ok),
      sla,
      mail: {
        mailboxes: results.length,
        created: results.reduce((a, r) => a + r.created, 0),
        appended: results.reduce((a, r) => a + r.appended, 0),
        deduped: results.reduce((a, r) => a + r.deduped, 0),
        results,
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, sla, error: safeErrorMessage(err) }, { status: 500 });
  }
}
