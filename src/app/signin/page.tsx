import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveSso } from "@/lib/auth/sso";

// Keep the sign-in page generic — the tab title must not identify the app.
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in",
};

/**
 * Sign-in page. Offers Microsoft Entra ID SSO when configured. When SSO is not
 * yet configured we show an honest empty state explaining how to bootstrap it
 * rather than a non-functional button.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const { error } = await searchParams;
  const sso = await resolveSso();

  async function doSignIn() {
    "use server";
    await signIn("microsoft-entra-id", { redirectTo: "/" });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted px-4 py-8">
      {/* Intentionally generic — no branding that identifies the application. */}
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>

      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">
        {error && (
          <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {error === "AccessDenied"
              ? "Access denied. Your account hasn’t been set up for this app — ask an administrator to add you, then try again."
              : "Sign-in failed. Please try again, or contact an administrator."}
          </div>
        )}
        {sso ? (
          <form action={doSignIn}>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Sign in with Microsoft SSO
            </button>
          </form>
        ) : (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm">
            <p className="font-medium text-foreground">SSO is not configured</p>
            <p className="mt-1 text-muted-foreground">
              Single sign-on has not been set up yet. To bootstrap the first
              admin, set <code className="font-mono">ENTRA_TENANT_ID</code>,{" "}
              <code className="font-mono">ENTRA_CLIENT_ID</code>,{" "}
              <code className="font-mono">ENTRA_CLIENT_SECRET</code> and{" "}
              <code className="font-mono">WOLF365_BOOTSTRAP_ADMINS</code> in your
              environment, then reload this page.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
