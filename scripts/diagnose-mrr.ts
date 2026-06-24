/**
 * Read-only MRR diagnostic. Run on a machine that has DATABASE_URL set (e.g.
 * your Mac with the project .env):
 *
 *   npx tsx scripts/diagnose-mrr.ts
 *
 * It NEVER writes. It reports how each TD SYNNEX subscription's billing
 * frequency is interpreted into a monthly figure, so you can confirm the
 * dashboard MRR is correct (or spot data-entry gaps) line by line.
 */
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  recurringSummary,
  monthlyRevenue,
  toRecurringInput,
  billingPeriodMonths,
} from "../src/lib/billing/recurring";

/**
 * Minimal .env loader (no dependency) so `npx tsx scripts/diagnose-mrr.ts`
 * works without exporting DATABASE_URL by hand. Existing env vars win.
 */
function loadEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(".env");
loadEnv(".env.local");

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Run this from the project root where .env lives, " +
      "or prefix the command: DATABASE_URL=... npx tsx scripts/diagnose-mrr.ts",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

async function main() {
  const subs = await prisma.tdSynnexSubscription.findMany({
    select: {
      productSku: true,
      quantity: true,
      unitCost: true,
      customerPrice: true,
      billingFrequency: true,
      commitmentTerm: true,
      status: true,
      currency: true,
    },
  });

  console.log(`\nTD SYNNEX subscriptions: ${subs.length}\n`);

  // 1) How each billing-frequency value is interpreted (the crux of the bug).
  const byFreq = new Map<
    string,
    { count: number; months: number; sampleMonthly: number[] }
  >();
  for (const s of subs) {
    const key = s.billingFrequency ?? "(blank)";
    const months = billingPeriodMonths(s.billingFrequency);
    const entry = byFreq.get(key) ?? { count: 0, months, sampleMonthly: [] };
    entry.count += 1;
    if (entry.sampleMonthly.length < 3) {
      entry.sampleMonthly.push(monthlyRevenue(toRecurringInput(s)));
    }
    byFreq.set(key, entry);
  }

  console.log("Billing frequency → divisor (months) → sample MRR/line:");
  console.log("-".repeat(72));
  for (const [freq, e] of [...byFreq.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const flag = e.months === 1 ? "  (treated as MONTHLY)" : "";
    console.log(
      `  ${freq.padEnd(22)} ×${String(e.count).padEnd(5)} ÷${e.months}${flag}` +
        `   e.g. ${e.sampleMonthly.map(money).join(", ")}`,
    );
  }

  // 2) Commitment-term distribution (for cross-checking).
  const byTerm = new Map<string, number>();
  for (const s of subs) {
    const k = s.commitmentTerm ?? "(blank)";
    byTerm.set(k, (byTerm.get(k) ?? 0) + 1);
  }
  console.log("\nCommitment term distribution:");
  for (const [t, c] of [...byTerm.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(22)} ${c}`);
  }

  // 3) Totals: corrected (period-normalized) vs naive (no division), so the
  //    size of any over-statement is obvious.
  const inputs = subs.map(toRecurringInput);
  const summary = recurringSummary(inputs);
  const naiveMrr = inputs.reduce((acc, s) => {
    if (s.status && /expire|cancel|inactiv|suspend|discontinu/i.test(s.status)) return acc;
    if ((s.billingFrequency ?? "").toLowerCase().includes("one")) return acc;
    return acc + (s.customerPrice ?? s.unitCost ?? 0) * s.quantity;
  }, 0);

  console.log("\nTotals:");
  console.log(`  Active recurring lines : ${summary.activeCount}`);
  console.log(`  MRR (period-normalized): ${money(summary.mrr)}`);
  console.log(`  ARR                    : ${money(summary.arr)}`);
  console.log(`  Monthly margin         : ${money(summary.monthlyMargin)} (${summary.marginPct}%)`);
  console.log(`  MRR if NOT normalized  : ${money(naiveMrr)}  <- if this matches the dashboard, annual prices weren't being divided`);
  console.log("");
}

main()
  .catch((err) => {
    console.error("diagnose-mrr failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
