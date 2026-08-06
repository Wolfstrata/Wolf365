"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";

/**
 * App-wide error boundary.
 *
 * A genuine permission failure throws ForbiddenError, whose name survives to the
 * client, so that case is identified rather than assumed. Everything else is a
 * real fault and says so — this page used to blame the viewer's role for *any*
 * thrown error, which sent people looking for an access problem that wasn't there
 * while the actual cause (a missing column, after a migration hadn't run) went
 * unmentioned.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface in the console for debugging; server-side logging happens upstream.
    console.error(error);
  }, [error]);

  const isPermission = error.name === "ForbiddenError";

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-md rounded-lg border bg-card p-6 text-center">
        <ShieldAlert
          className={`mx-auto h-8 w-8 ${isPermission ? "text-warning" : "text-danger"}`}
        />
        <h1 className="mt-3 text-lg font-semibold">
          {isPermission ? "This page isn’t available" : "Something went wrong"}
        </h1>
        {isPermission ? (
          <p className="mt-1 text-sm text-muted-foreground">
            You don’t have access to it in your current role. If you’re previewing as another
            role, exit the preview from the sidebar to return to your full view.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              This page failed to load. It isn’t a permissions problem — your role has access.
              An administrator can see the cause in Administration → Debug Logs, or in the
              deployment logs.
            </p>
            {error.digest && (
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                Reference: {error.digest}
              </p>
            )}
          </>
        )}
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
