import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/primitives";
import { ProbeForm } from "./probe-form";

/**
 * Admin API probe — make a real authenticated GET against a connector's base
 * URL to discover the correct endpoint/parameters. Owner/admin only.
 */
export default async function ApiProbePage() {
  await requirePermission("connectors:configure");
  return (
    <div>
      <PageHeader
        title="API Probe"
        description="Send a real authenticated GET to a connector endpoint and inspect the raw response. Useful for finding the correct resource path."
      />
      <div className="p-8">
        <ProbeForm />
      </div>
    </div>
  );
}
