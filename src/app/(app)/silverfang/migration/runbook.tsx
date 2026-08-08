import Link from "next/link";
import type { ReactNode } from "react";

/**
 * One numbered step of the migration, with the button that performs it.
 *
 * The buttons for this job live on four different screens, each in the place
 * that makes sense when you are already there — the ticket import next to the
 * tickets, the connector sync on Connector Data. That is right for each screen
 * on its own and wrong for the migration, which is a sequence: worklogs cannot
 * import before tickets, and conversations cannot import before either. Running
 * it meant knowing the order and navigating between screens to follow it.
 *
 * So the steps are gathered here in the order they have to happen, and the
 * originals stay exactly where they were. Nothing is duplicated but the layout:
 * every step renders the same component, wired to the same action, as the screen
 * it also appears on.
 */
export function Step({
  n,
  title,
  detail,
  where,
  href,
  children,
}: {
  n: number;
  title: string;
  detail: string;
  /** The screen this same button also lives on, named so the two are not mistaken for different features. */
  where?: string;
  href?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3 border-t py-4 first:border-t-0 first:pt-0">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
          {where && href && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Also on{" "}
              <Link href={href} className="text-primary hover:underline">
                {where}
              </Link>
              .
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** The heading that separates mirroring from importing. */
export function StageHeading({
  label,
  title,
  detail,
}: {
  label: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <h2 className="mt-0.5 text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
