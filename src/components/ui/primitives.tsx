import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Page header with title, optional description, and right-aligned actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-8 sm:py-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
      )}
    </div>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-5", className)}>
      {children}
    </div>
  );
}

/** Honest empty state — never pretends data exists. */
export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
      {icon && <div className="mb-3 text-muted-foreground">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

const HEALTH_STYLES: Record<string, string> = {
  HEALTHY: "bg-success/15 text-success",
  ERROR: "bg-danger/15 text-danger",
  DEGRADED: "bg-warning/15 text-warning",
  UNCONFIGURED: "bg-muted text-muted-foreground",
};

export function HealthBadge({ health }: { health: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        HEALTH_STYLES[health] ?? HEALTH_STYLES.UNCONFIGURED,
      )}
    >
      {health.charAt(0) + health.slice(1).toLowerCase()}
    </span>
  );
}

export function StatItem({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}
