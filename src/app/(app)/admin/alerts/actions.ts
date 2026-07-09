"use server";

import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";

export interface TestDigestResult {
  ok: boolean;
  message: string;
  renewals?: number;
  costChanges?: number;
  sent?: boolean;
  recipients?: string[];
}

export interface SnapshotResult {
  ok: boolean;
  message: string;
}

/**
 * Capture an M365 cost baseline on demand: snapshot the current month and, if no
 * prior-month snapshot exists yet, seed a previous-month baseline from current
 * figures so month-over-month cost-change detection is active immediately.
 */
export async function captureCostBaselineAction(
  _prev: SnapshotResult | null,
  _formData: FormData,
): Promise<SnapshotResult> {
  const user = await requirePermission("connectors:configure");
  try {
    const { captureBaselineNow } = await import("@/lib/licensing/snapshot");
    const res = await captureBaselineNow(new Date());
    if (res === null) {
      return { ok: false, message: "Could not access the cost-snapshot table on the app database." };
    }
    await audit({
      action: "SYNC_RUN",
      actorId: user.id,
      actorEmail: user.email,
      target: "m365:cost-baseline",
      metadata: { current: res.current, seededPrevious: res.seededPrevious, hadPrevious: res.hadPrevious },
    });
    const baseline = res.hadPrevious
      ? "A prior-month baseline already existed, so change detection was already armed."
      : `Seeded a ${res.seededPrevious}-subscription baseline for last month — cost changes are now flagged from today's values onward.`;
    return {
      ok: true,
      message: `Captured ${res.current} current-month snapshot${res.current === 1 ? "" : "s"}. ${baseline}`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/**
 * Run the M365 alert digest on demand (bypassing the weekly Monday schedule) so
 * an admin can verify Resend delivery immediately. Uses the same code path the
 * cron uses. If Resend rejects the send (e.g. an unverified sender domain), the
 * real error is surfaced here.
 */
export async function sendTestDigestAction(
  _prev: TestDigestResult | null,
  _formData: FormData,
): Promise<TestDigestResult> {
  const user = await requirePermission("connectors:configure");
  try {
    const { runM365AlertDigest } = await import("@/lib/licensing/alerts");
    const res = await runM365AlertDigest(new Date());
    await audit({
      action: "SYNC_RUN",
      actorId: user.id,
      actorEmail: user.email,
      target: "alerts:test-digest",
      metadata: {
        renewals: res.renewals,
        costChanges: res.costChanges,
        sent: res.email.sent,
      },
    });

    const summary = `${res.renewals} renewal${res.renewals === 1 ? "" : "s"}, ${
      res.costChanges
    } cost change${res.costChanges === 1 ? "" : "s"}.`;

    if (res.email.sent) {
      return {
        ok: true,
        message: `Sent to ${res.email.to?.join(", ")} — ${summary}`,
        renewals: res.renewals,
        costChanges: res.costChanges,
        sent: true,
        recipients: res.email.to,
      };
    }

    // Not sent: fine if there was simply nothing to report; otherwise surface why.
    const nothingToReport = res.renewals + res.costChanges === 0;
    return {
      ok: nothingToReport,
      message: nothingToReport
        ? `Nothing to report right now — no email sent. ${summary}`
        : `Not sent: ${res.email.reason ?? "unknown reason"}. ${summary}`,
      renewals: res.renewals,
      costChanges: res.costChanges,
      sent: false,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
