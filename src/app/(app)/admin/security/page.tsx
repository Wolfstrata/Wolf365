import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { resolveSso } from "@/lib/auth/sso";
import { PageHeader, Card } from "@/components/ui/primitives";
import { SsoForm } from "./sso-form";

/** Security & SSO administration. Configure Entra ID sign-in. */
export default async function SecurityPage() {
  await requirePermission("sso:configure");

  const settings = await prisma.ssoSettings.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
  });
  const resolved = await resolveSso();

  const initial = settings
    ? {
        tenantId: settings.tenantId,
        clientId: settings.clientId,
        allowedDomains: settings.allowedDomains.join(", "),
        groupMappings: Object.entries(
          (settings.groupRoleMappings ?? {}) as Record<string, string>,
        )
          .map(([g, r]) => `${g}:${r}`)
          .join("\n"),
        secretSet: true,
      }
    : null;

  return (
    <div>
      <PageHeader
        title="Security & SSO"
        description="Configure Microsoft Entra ID single sign-on, allowed domains, and group-to-role mapping."
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Card>
          <h2 className="text-sm font-semibold">Current sign-in source</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {resolved
              ? resolved.source === "database"
                ? "Using SSO settings configured in this app."
                : "Using first-run environment bootstrap (ENTRA_*). Save settings below to manage SSO in-app."
              : "SSO is not configured. Set the values below or provide ENTRA_* environment variables to bootstrap."}
          </p>
        </Card>

        <SsoForm initial={initial} />
      </div>
    </div>
  );
}
