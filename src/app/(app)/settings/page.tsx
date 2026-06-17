import { requireUser } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";
import { TimezoneForm } from "./timezone-form";

export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Personal preferences for your Wolf365 account."
      />
      <div className="space-y-6 p-8">
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
      </div>
    </div>
  );
}
