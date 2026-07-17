import type { DsoPoint } from "@/lib/reports/dso";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtPeriod(period: string): string {
  const [y, m] = period.split("-");
  const mi = Number(m) - 1;
  return `${MONTHS[mi] ?? m} ${y}`;
}

/**
 * DSO trend line chart (inline SVG, theme-aware). Plots cash-weighted collection
 * DSO by invoice-cohort month across the selected date range. No client JS —
 * hover titles give per-point detail.
 */
export function DsoChart({ points }: { points: DsoPoint[] }) {
  const W = 800;
  const H = 220;
  const padL = 44;
  const padR = 14;
  const padT = 14;
  const padB = 30;
  const n = points.length;

  const maxDso = Math.max(1, ...points.map((p) => p.dso));
  const niceMax = Math.max(10, Math.ceil(maxDso / 10) * 10);

  const xAt = (i: number) => (n <= 1 ? padL + (W - padL - padR) / 2 : padL + (i / (n - 1)) * (W - padL - padR));
  const yAt = (v: number) => padT + (1 - v / niceMax) * (H - padT - padB);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.dso).toFixed(1)}`).join(" ");
  const gridVals = [0, niceMax / 2, niceMax];

  // Label a handful of x ticks (first, last, and evenly-spaced middles).
  const tickIdx = new Set<number>([0, n - 1]);
  if (n > 4) {
    tickIdx.add(Math.round((n - 1) / 3));
    tickIdx.add(Math.round((2 * (n - 1)) / 3));
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="DSO over time">
      {/* Gridlines + y labels */}
      {gridVals.map((v) => (
        <g key={v}>
          <line
            x1={padL}
            x2={W - padR}
            y1={yAt(v)}
            y2={yAt(v)}
            className="text-border"
            stroke="currentColor"
            strokeWidth={1}
          />
          <text
            x={padL - 6}
            y={yAt(v) + 3}
            textAnchor="end"
            className="text-muted-foreground"
            fill="currentColor"
            fontSize={10}
          >
            {Math.round(v)}
          </text>
        </g>
      ))}

      {/* Line */}
      {n > 1 && (
        <path d={linePath} className="text-primary" stroke="currentColor" strokeWidth={2} fill="none" />
      )}

      {/* Points */}
      {points.map((p, i) => (
        <circle key={p.period} cx={xAt(i)} cy={yAt(p.dso)} r={n > 60 ? 1.5 : 3} className="text-primary" fill="currentColor">
          <title>{`${fmtPeriod(p.period)}: ${p.dso} days DSO`}</title>
        </circle>
      ))}

      {/* x labels */}
      {points.map((p, i) =>
        tickIdx.has(i) ? (
          <text
            key={`x-${p.period}`}
            x={xAt(i)}
            y={H - 10}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            className="text-muted-foreground"
            fill="currentColor"
            fontSize={10}
          >
            {fmtPeriod(p.period)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
