import Link from "next/link";
import { BookOpen, ExternalLink, Server, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/local-time";

/**
 * What Hudu already knows about this client, shown inside SilverFang so a tech
 * on a ticket does not have to go looking: the company record, its assets, and
 * links to its documentation.
 *
 * Everything here is a link back into Hudu for the detail. That is deliberate —
 * Hudu stays the system of record for documentation, and the values it holds
 * behind confidential fields are never copied into Wolf365, so the only correct
 * place to read them is Hudu itself.
 */

interface SafeField {
  label: string;
  value: string;
}

function fieldsOf(value: unknown): SafeField[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (f): f is SafeField =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as SafeField).label === "string" &&
      typeof (f as SafeField).value === "string",
  );
}

export async function HuduCard({ clientId }: { clientId: string }) {
  const company = await prisma.huduCompany.findUnique({
    where: { clientId },
    include: {
      assets: {
        where: { archived: false },
        orderBy: [{ assetLayout: "asc" }, { name: "asc" }],
        take: 100,
      },
      articles: {
        where: { archived: false },
        orderBy: { name: "asc" },
        take: 50,
      },
    },
  });

  // No linked Hudu company is the normal state for a client Hudu doesn't hold,
  // so this says nothing rather than showing an empty shell.
  if (!company) return null;

  const byLayout = new Map<string, typeof company.assets>();
  for (const a of company.assets) {
    const key = a.assetLayout ?? "Other";
    const list = byLayout.get(key) ?? [];
    list.push(a);
    byLayout.set(key, list);
  }
  const withheld = company.assets.reduce((sum, a) => sum + a.redactedFieldCount, 0);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">Hudu</h2>
        {company.huduUrl && (
          <a
            href={company.huduUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open in Hudu
          </a>
        )}
        <Link
          href={`/synced/hudu/${company.id}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Synced record
        </Link>
        <span className="ml-auto text-xs text-muted-foreground">
          Synced <LocalTime value={company.lastSyncedAt} />
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        {company.companyType && (
          <p>
            <span className="text-muted-foreground">Type</span> {company.companyType}
          </p>
        )}
        {company.phone && (
          <p>
            <span className="text-muted-foreground">Phone</span> {company.phone}
          </p>
        )}
        {company.website && (
          <p className="truncate">
            <span className="text-muted-foreground">Web</span>{" "}
            <a
              href={company.website}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary hover:underline"
            >
              {company.website.replace(/^https?:\/\//, "")}
            </a>
          </p>
        )}
        {company.address && (
          <p className="sm:col-span-2">
            <span className="text-muted-foreground">Address</span> {company.address}
          </p>
        )}
      </div>

      <div className="mt-4">
        <h3 className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
          <Server className="h-3.5 w-3.5" /> Assets ({company.assets.length})
        </h3>
        {company.assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assets synced for this company.</p>
        ) : (
          <div className="space-y-3">
            {[...byLayout.entries()].map(([layout, assets]) => (
              <div key={layout}>
                <p className="text-xs font-medium">{layout}</p>
                <ul className="mt-1 divide-y rounded-md border text-sm">
                  {assets.map((a) => {
                    const fields = fieldsOf(a.fields);
                    return (
                      <li key={a.id} className="px-3 py-1.5">
                        <div className="flex flex-wrap items-center gap-x-3">
                          {a.huduUrl ? (
                            <a
                              href={a.huduUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="font-medium text-primary hover:underline"
                            >
                              {a.name}
                            </a>
                          ) : (
                            <span className="font-medium">{a.name}</span>
                          )}
                          {a.manufacturer && (
                            <span className="text-xs text-muted-foreground">
                              {a.manufacturer}
                              {a.model ? ` ${a.model}` : ""}
                            </span>
                          )}
                          {a.serial && (
                            <span className="text-xs text-muted-foreground">s/n {a.serial}</span>
                          )}
                          {a.redactedFieldCount > 0 && (
                            <span
                              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground"
                              title="Confidential fields are never copied out of Hudu — open the asset in Hudu to see them."
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                              {a.redactedFieldCount} in Hudu only
                            </span>
                          )}
                        </div>
                        {fields.length > 0 && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {fields
                              .slice(0, 6)
                              .map((f) => `${f.label}: ${f.value}`)
                              .join(" · ")}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <h3 className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" /> Documentation ({company.articles.length})
        </h3>
        {company.articles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No articles synced for this company.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {company.articles.map((a) => (
              <li key={a.id}>
                {a.huduUrl ? (
                  <a
                    href={a.huduUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition hover:bg-accent"
                  >
                    {a.folder ? `${a.folder} / ` : ""}
                    {a.name}
                  </a>
                ) : (
                  <span className="inline-flex rounded-md border px-2.5 py-1 text-xs">{a.name}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {withheld > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {withheld} confidential field{withheld === 1 ? "" : "s"} across these assets are held in
          Hudu only. Wolf365 never copies passwords, keys or article bodies out of Hudu — open the
          record there to read them.
        </p>
      )}
    </Card>
  );
}
