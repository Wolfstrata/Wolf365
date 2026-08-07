import Link from "next/link";
import { BookOpen, ExternalLink, Server, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { huduContextFor } from "@/lib/silverfang/hudu-context";

/**
 * Hudu context on a ticket: what this client's kit and documentation is, without
 * leaving the ticket.
 *
 * Compact and collapsed by default, unlike the client page's full card. A tech
 * reading a ticket wants the serial number of one machine and the link to one
 * runbook — a hundred expanded asset rows above the activity feed would push the
 * actual conversation off the screen.
 *
 * Renders nothing when Hudu holds no company for the client.
 */
export async function TicketHuduPanel({ clientId }: { clientId: string }) {
  const hudu = await huduContextFor(clientId);
  if (!hudu) return null;

  return (
    <Card>
      <details>
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold">Hudu</h2>
            <span className="text-xs text-muted-foreground">
              {hudu.assets.length} asset{hudu.assets.length === 1 ? "" : "s"} ·{" "}
              {hudu.articles.length} doc{hudu.articles.length === 1 ? "" : "s"}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">Show</span>
          </div>
        </summary>

        <div className="mt-3 space-y-4">
          {/* Outside the summary on purpose: a link inside it would toggle the
              panel shut on the same click that follows it. */}
          {hudu.huduUrl && (
            <a
              href={hudu.huduUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open {hudu.name} in Hudu
            </a>
          )}

          {hudu.assets.length > 0 && (
            <div>
              <h3 className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
                <Server className="h-3.5 w-3.5" /> Assets
              </h3>
              <div className="space-y-2">
                {hudu.assetsByLayout.map(({ layout, assets }) => (
                  <div key={layout}>
                    <p className="text-xs font-medium">{layout}</p>
                    <ul className="mt-1 divide-y rounded-md border text-sm">
                      {assets.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5">
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
                          {/* The serial is the single most-asked-for field on a
                              support call, so it is on the row, not behind a link. */}
                          {a.serial && (
                            <span className="font-mono text-xs text-muted-foreground">
                              s/n {a.serial}
                            </span>
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
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hudu.articles.length > 0 && (
            <div>
              <h3 className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" /> Documentation
              </h3>
              <ul className="flex flex-wrap gap-2">
                {hudu.articles.map((a) => (
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
                      <span className="inline-flex rounded-md border px-2.5 py-1 text-xs">
                        {a.name}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hudu.assets.length === 0 && hudu.articles.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Hudu holds a company record for this client but no assets or articles have synced.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            {hudu.withheldFields > 0 &&
              `${hudu.withheldFields} confidential field${
                hudu.withheldFields === 1 ? "" : "s"
              } are held in Hudu only. `}
            Wolf365 never copies passwords, keys or article bodies out of Hudu — open the record
            there to read them.{" "}
            <Link href={`/silverfang/clients/${clientId}`} className="underline">
              Full Hudu detail on the client
            </Link>
            .
          </p>
        </div>
      </details>
    </Card>
  );
}
