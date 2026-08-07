import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  /** Omit on the last crumb — you are already there. */
  href?: string;
}

/**
 * Where you are, and how to get back.
 *
 * A drill-down without a trail leaves you guessing which project a ticket belongs
 * to, and with the browser's Back button as the only way up. The last crumb is
 * plain text rather than a link to itself, so the trail says where you are instead
 * of offering a no-op.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const visible = items.filter((c) => c.label.trim() !== "");
  if (visible.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
      {visible.map((crumb, i) => {
        const last = i === visible.length - 1;
        return (
          <span key={`${crumb.label}-${i}`} className="inline-flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            {crumb.href && !last ? (
              <Link href={crumb.href} className="text-muted-foreground hover:text-foreground">
                {crumb.label}
              </Link>
            ) : (
              <span className={last ? "font-medium" : "text-muted-foreground"}>{crumb.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
