import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { getConnectorViews } from "@/lib/connectors/service";
import { PageHeader, Card, HealthBadge } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/local-time";

/** Admin connector overview. Lists all connectors with health and last sync. */
export default async function ConnectorsPage() {
  await requirePermission("connectors:read");
  const connectors = await getConnectorViews();

  return (
    <div>
      <PageHeader
        title="Connectors"
        description="Configure and monitor integrations. Test Connection and Sync perform real API calls."
      />
      <div className="space-y-3 p-4 sm:p-8">
        {connectors.map((c) => (
          <Link key={c.type} href={`/admin/connectors/${c.type}`}>
            <Card className="flex items-center justify-between transition hover:border-primary/40">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="font-medium">{c.displayName}</h2>
                  <HealthBadge health={c.health} />
                  {c.enabled ? (
                    <span className="text-xs text-success">Enabled</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Disabled</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {c.description}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Last successful sync: <LocalTime value={c.lastSuccessfulSyncAt} />
                  {c.lastError ? ` · Last error: ${c.lastError}` : ""}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
