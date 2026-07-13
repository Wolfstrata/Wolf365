"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";

/**
 * App-wide error boundary. The most common recoverable case is a permission
 * error — e.g. an administrator previewing the app as a lesser role ("View as")
 * who lands on a page that role can't access. Rather than a raw crash, show a
 * friendly card with a way back. (In production, server error messages are
 * redacted to a digest, so we keep the copy general.)
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

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-md rounded-lg border bg-card p-6 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-warning" />
        <h1 className="mt-3 text-lg font-semibold">This page isn’t available</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You may not have access to it in your current role. If you’re previewing
          as another role, exit the preview from the sidebar to return to your
          full view.
        </p>
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
