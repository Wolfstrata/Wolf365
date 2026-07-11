import { LifeBuoy } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";
import { supportContact } from "@/lib/support";
import { TimezoneForm } from "./timezone-form";

export default async function SettingsPage() {
  const user = await requireUser();
  const support = supportContact();

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Personal preferences for your Wolf365 account."
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Card>
          <h2 className="text-sm font-semibold">Display timezone</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Current time in your timezone:{" "}
            <strong>{formatDateTime(new Date(), user.timezone)}</strong>
          </p>
          <div className="mt-4">
            <TimezoneForm current={user.timezone} />
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold">Help &amp; support</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Need help with Wolf365 or hit an error? Contact our support team and
            include any error details shown in the app.
          </p>
          <a
            href={support.href}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-accent"
          >
            <LifeBuoy className="h-4 w-4" /> Contact support
          </a>
          <p className="mt-2 text-xs text-muted-foreground">{support.value}</p>
        </Card>
      </div>
    </div>
  );
}
