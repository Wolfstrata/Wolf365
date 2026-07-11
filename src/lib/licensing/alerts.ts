import "server-only";
import { prisma } from "@/lib/db";
import { renewalWindow, type RenewalBucket } from "@/lib/licensing/renewal";
import { isM365Subscription } from "@/lib/licensing/vendor";
import { costChanges } from "@/lib/licensing/cost-change";
import { previousMonthCosts } from "@/lib/licensing/snapshot";
import { sendEmail, type SendEmailResult } from "@/lib/email/resend";
import { formatCurrency } from "@/lib/utils";

/**
 * M365 licensing alert digest: subscriptions renewing within 90/60/30 days plus
 * cost/price changes vs the previous month, composed into one email sent via
 * Resend. Sending is gated on RESEND_API_KEY (no key → computed but not sent).
 * Intended to run weekly from the cron.
 */

export interface AlertSummary {
  renewals: number;
  costChanges: number;
  email: SendEmailResult;
}

interface RenewalRow {
  customer: string;
  product: string;
  date: string;
  days: number;
}
interface CostRow {
  customer: string;
  product: string;
  field: string;
  from: string;
  to: string;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

function isoDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export async function runM365AlertDigest(now: Date): Promise<AlertSummary> {
  const subs = (
    await prisma.tdSynnexSubscription.findMany({
      include: { customer: { select: { name: true } } },
      orderBy: [{ renewalDate: "asc" }],
    })
  ).filter((s) => !s.archived && isM365Subscription(s)); // M365 only, not filed away

  const byBucket: Record<RenewalBucket, RenewalRow[]> = { 30: [], 60: [], 90: [] };
  for (const s of subs) {
    const win = renewalWindow(s.renewalDate, now);
    if (!win) continue;
    byBucket[win.bucket].push({
      customer: s.customer.name,
      product: s.productName ?? s.productSku ?? "—",
      date: isoDate(s.renewalDate),
      days: win.daysUntil,
    });
  }
  const renewals = byBucket[30].length + byBucket[60].length + byBucket[90].length;

  const prev = await previousMonthCosts(subs.map((s) => s.stellrSubscriptionId), now);
  const costRows: CostRow[] = [];
  for (const s of subs) {
    const currency = s.currency ?? "CAD";
    const changes = costChanges(
      {
        unitCost: s.unitCost != null ? Number(s.unitCost) : null,
        customerPrice: s.customerPrice != null ? Number(s.customerPrice) : null,
      },
      prev.get(s.stellrSubscriptionId) ?? null,
    );
    for (const c of changes) {
      costRows.push({
        customer: s.customer.name,
        product: s.productName ?? s.productSku ?? "—",
        field: c.field === "unitCost" ? "Our cost" : "Customer price",
        from: formatCurrency(c.previous, currency),
        to: formatCurrency(c.current, currency),
      });
    }
  }

  if (renewals === 0 && costRows.length === 0) {
    return { renewals: 0, costChanges: 0, email: { sent: false, reason: "Nothing to report" } };
  }

  const subject = `Wolf365 M365 alerts — ${renewals} renewing, ${costRows.length} cost change${
    costRows.length === 1 ? "" : "s"
  }`;
  const { html, text } = compose(byBucket, costRows);
  const email = await sendEmail({ subject, html, text });
  return { renewals, costChanges: costRows.length, email };
}

function compose(
  byBucket: Record<RenewalBucket, RenewalRow[]>,
  costRows: CostRow[],
): { html: string; text: string } {
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  const renewalSection = (bucket: RenewalBucket, label: string) => {
    const rows = byBucket[bucket];
    if (rows.length === 0) return;
    htmlParts.push(`<h3>${esc(label)} (${rows.length})</h3><ul>`);
    textParts.push(`\n${label} (${rows.length}):`);
    for (const r of rows) {
      htmlParts.push(
        `<li>${esc(r.customer)} — ${esc(r.product)} · renews ${esc(r.date)} (in ${r.days}d)</li>`,
      );
      textParts.push(`  - ${r.customer} — ${r.product} · renews ${r.date} (in ${r.days}d)`);
    }
    htmlParts.push(`</ul>`);
  };

  htmlParts.push(`<h2>Upcoming M365 renewals</h2>`);
  textParts.push(`UPCOMING M365 RENEWALS`);
  renewalSection(30, "Renewing within 30 days");
  renewalSection(60, "Renewing within 60 days");
  renewalSection(90, "Renewing within 90 days");
  if (byBucket[30].length + byBucket[60].length + byBucket[90].length === 0) {
    htmlParts.push(`<p>None in the next 90 days.</p>`);
    textParts.push(`  None in the next 90 days.`);
  }

  htmlParts.push(`<h2>Cost changes vs last month</h2>`);
  textParts.push(`\nCOST CHANGES VS LAST MONTH`);
  if (costRows.length === 0) {
    htmlParts.push(`<p>No changes.</p>`);
    textParts.push(`  No changes.`);
  } else {
    htmlParts.push(`<ul>`);
    for (const r of costRows) {
      htmlParts.push(
        `<li>${esc(r.customer)} — ${esc(r.product)}: ${esc(r.field)} ${esc(r.from)} → ${esc(r.to)}</li>`,
      );
      textParts.push(`  - ${r.customer} — ${r.product}: ${r.field} ${r.from} -> ${r.to}`);
    }
    htmlParts.push(`</ul>`);
  }

  return { html: htmlParts.join("\n"), text: textParts.join("\n") };
}
