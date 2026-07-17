import { formatCurrency } from "@/lib/utils";
import type {
  CustomerRow,
  FollowUpRow,
  Mover,
  SpendMover,
  TierSummary,
} from "@/lib/reports/dso";

export const num = (n: number) => Math.round(n).toLocaleString("en-US");

function Shell({
  head,
  children,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const th = (label: string, right = false) => (
  <th key={label} className={`px-4 py-2 font-medium ${right ? "text-right" : ""}`}>
    {label}
  </th>
);

export type CustomerVariant = "revenue" | "drag" | "worst" | "best";

export function CustomerTable({
  rows,
  variant,
}: {
  rows: CustomerRow[];
  variant: CustomerVariant;
}) {
  if (variant === "revenue") {
    return (
      <Shell head={[th("Customer"), th("Cash received", true), th("DSO", true), th("Avg days late", true), th("Tier")]}>
        {rows.map((r) => (
          <tr key={r.customerId} className="border-t">
            <td className="px-4 py-2 font-medium">{r.customer}</td>
            <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(r.cashReceived)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{r.dso ?? "—"}</td>
            <td className="px-4 py-2 text-right tabular-nums">{r.avgDaysLate ?? "—"}</td>
            <td className="px-4 py-2">{r.tier}</td>
          </tr>
        ))}
      </Shell>
    );
  }
  if (variant === "drag") {
    return (
      <Shell head={[th("Customer"), th("Cash received", true), th("Avg days late", true), th("Drag ($-days)", true)]}>
        {rows.map((r) => (
          <tr key={r.customerId} className="border-t">
            <td className="px-4 py-2 font-medium">{r.customer}</td>
            <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(r.cashReceived)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{r.avgDaysLate ?? "—"}</td>
            <td className="px-4 py-2 text-right tabular-nums">{num(r.drag)}</td>
          </tr>
        ))}
      </Shell>
    );
  }
  if (variant === "worst") {
    return (
      <Shell head={[th("Customer"), th("Revenue", true), th("Avg late", true)]}>
        {rows.map((r) => (
          <tr key={r.customerId} className="border-t">
            <td className="px-4 py-2 font-medium">{r.customer}</td>
            <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(r.cashReceived)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{r.avgDaysLate ?? "—"}</td>
          </tr>
        ))}
      </Shell>
    );
  }
  // best
  return (
    <Shell head={[th("Customer"), th("Revenue", true), th("On-time $", true)]}>
      {rows.map((r) => (
        <tr key={r.customerId} className="border-t">
          <td className="px-4 py-2 font-medium">{r.customer}</td>
          <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(r.cashReceived)}</td>
          <td className="px-4 py-2 text-right tabular-nums">
            {r.onTimeCashPct != null ? `${r.onTimeCashPct}%` : "—"}
          </td>
        </tr>
      ))}
    </Shell>
  );
}

export function FollowUpTable({ rows }: { rows: FollowUpRow[] }) {
  return (
    <Shell
      head={[
        th("#"),
        th("Customer"),
        th("Late amount (>30d)", true),
        th("Max days late", true),
        th("Avg days late", true),
        th("Priority score", true),
      ]}
    >
      {rows.map((r, i) => (
        <tr key={r.customerId} className={`border-t ${r.large ? "bg-danger/5" : ""}`}>
          <td className="px-4 py-2 tabular-nums">{i + 1}</td>
          <td className="px-4 py-2 font-medium">
            {r.customer}
            {r.large && (
              <span className="ml-2 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">
                $10k+
              </span>
            )}
          </td>
          <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(r.lateAmount)}</td>
          <td className="px-4 py-2 text-right tabular-nums">{r.maxDaysLate}</td>
          <td className="px-4 py-2 text-right tabular-nums">{r.avgDaysLate ?? "—"}</td>
          <td className="px-4 py-2 text-right font-semibold tabular-nums">{num(r.score)}</td>
        </tr>
      ))}
    </Shell>
  );
}

export function TierTable({ tiers }: { tiers: TierSummary[] }) {
  return (
    <Shell head={[th("Tier"), th("Customers", true), th("%", true), th("Cash received", true), th("Drag ($-days)", true)]}>
      {tiers.map((t) => (
        <tr key={t.tier} className="border-t">
          <td className="px-4 py-2">{t.tier}</td>
          <td className="px-4 py-2 text-right tabular-nums">{t.customers}</td>
          <td className="px-4 py-2 text-right tabular-nums">{t.pctCustomers}%</td>
          <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(t.cashReceived)}</td>
          <td className="px-4 py-2 text-right tabular-nums">{num(t.drag)}</td>
        </tr>
      ))}
    </Shell>
  );
}

export function MoverTable({
  rows,
  priorYear,
  compareYear,
  kind,
}: {
  rows: Mover[];
  priorYear: number;
  compareYear: number;
  kind: "improved" | "worsened";
}) {
  return (
    <Shell head={[th(kind === "improved" ? "Improved" : "Worsened"), th(String(priorYear), true), th(String(compareYear), true), th("Change", true)]}>
      {rows.map((m) => (
        <tr key={m.customer} className="border-t">
          <td className="px-4 py-2">{m.customer}</td>
          <td className="px-4 py-2 text-right tabular-nums">{m.prior}</td>
          <td className="px-4 py-2 text-right tabular-nums">{m.current}</td>
          <td className={`px-4 py-2 text-right tabular-nums ${kind === "improved" ? "text-success" : "text-danger"}`}>
            {kind === "worsened" && m.change > 0 ? "+" : ""}
            {m.change}
          </td>
        </tr>
      ))}
      {rows.length === 0 && (
        <tr className="border-t">
          <td className="px-4 py-2 text-muted-foreground" colSpan={4}>None</td>
        </tr>
      )}
    </Shell>
  );
}

export function SpendMoverTable({
  rows,
  priorYear,
  compareYear,
  kind,
}: {
  rows: SpendMover[];
  priorYear: number;
  compareYear: number;
  kind: "up" | "down";
}) {
  return (
    <Shell head={[th(kind === "up" ? "Expanding" : "Contracting"), th(String(priorYear), true), th(String(compareYear), true), th("Change", true)]}>
      {rows.map((s) => (
        <tr key={s.customer} className="border-t">
          <td className="px-4 py-2">{s.customer}</td>
          <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(s.spendPrior)}</td>
          <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(s.spendCurrent)}</td>
          <td className={`px-4 py-2 text-right tabular-nums ${kind === "up" ? "text-success" : "text-danger"}`}>
            {s.change > 0 ? "+" : ""}
            {formatCurrency(s.change)}
            {s.pctChange != null ? ` (${s.pctChange > 0 ? "+" : ""}${s.pctChange}%)` : ""}
          </td>
        </tr>
      ))}
      {rows.length === 0 && (
        <tr className="border-t">
          <td className="px-4 py-2 text-muted-foreground" colSpan={4}>None</td>
        </tr>
      )}
    </Shell>
  );
}
