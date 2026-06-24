import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveSso } from "@/lib/auth/sso";

/**
 * Sign-in page. Offers Microsoft Entra ID SSO when configured. When SSO is not
 * yet configured we show an honest empty state explaining how to bootstrap it
 * rather than a non-functional button.
 */
export default async function SignInPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const sso = await resolveSso();

  async function doSignIn() {
    "use server";
    await signIn("microsoft-entra-id", { redirectTo: "/" });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted px-4 py-8">
      {/* Brand hero — sized to keep the sign-in button above the fold */}
      <div className="flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/Wolf365 Logo.png"
          alt="Wolf365"
          className="h-auto w-full max-w-md max-h-[40vh] object-contain"
        />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Microsoft 365 Billing Application
        </h1>
      </div>

      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">
        {sso ? (
          <form action={doSignIn}>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Sign in with Microsoft
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
