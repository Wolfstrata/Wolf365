import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, StatItem, EmptyState } from "@/components/ui/primitives";
import { PawTip } from "@/components/ui/paw-tip";
import { formatCurrency } from "@/lib/utils";
import {
  CHARGE_CODE_KIND_LABELS,
  PRIORITY_LABELS,
  TIME_BAND_LABELS,
} from "@/lib/silverfang/constants";
import { SeedButton } from "./seed-button";

import {
  CalendarEditor,
  ChargeCodeEditor,
  RateRuleEditor,
  SlaTargetEditor,
  type ChargeCodeRow,
  type RateRuleRow,
} from "./config-forms";

import { TechProfiles, type TechProfileRow } from "./tech-profiles";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * SilverFang configuration overview: boards/statuses, SLAs (targets + business
 * hours), charge codes and rate rules. Read-only for now — the seed action
 * creates a working default set; per-record editors come with the later phases.
 */
export default async function SilverFangSetupPage() {
  await requirePermission("silverfang:configure");

  const [boards, slas, chargeCodes, rateRules, counts] = await Promise.all([
    prisma.sfBoard.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        statuses: { orderBy: { sortOrder: "asc" } },
        sla: { select: { name: true } },
      },
    }),
    prisma.sfSla.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        targets: true,
        businessHours: { orderBy: { weekday: "asc" } },
        holidays: { orderBy: { date: "asc" } },
      },
    }),
    prisma.sfChargeCode.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.sfRateRule.findMany({
      orderBy: { scope: "asc" },
      // clientId is a plain column on SfRateRule (no relation), so client names
      // are resolved from the client list below rather than by include.
      include: { chargeCode: { select: { code: true } }, agreement: { select: { name: true } } },
    }),
    Promise.all([
      prisma.sfTicket.count(),
      prisma.sfContact.count(),
      prisma.sfAgreement.count(),
      prisma.sfProject.count(),
      prisma.sfTimeEntry.count(),
    ]),
  ]);

  const [tickets, contacts, agreements, projects, timeEntries] = counts;

  // Extra lookups for the configuration editors.
  const [setupClients, setupAgreementRows, chargeCodeUsage, techUsers, techProfiles, syncedLinks] =
    await Promise.all([
    prisma.client.findMany({
      where: { archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 2000,
    }),
    prisma.sfAgreement.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, client: { select: { name: true } } },
      take: 500,
    }),
    prisma.sfTimeEntry.groupBy({ by: ["chargeCodeId"], _count: { _all: true } }),
    // Only users who can actually log time — a calendar setting for someone with
    // no SilverFang access is a row nobody will ever use.
    prisma.user.findMany({
      where: { disabled: false, role: { in: ["ADMINISTRATOR", "POWER_USER", "SILVERFANG_ADMIN", "SILVERFANG_USER"] } },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true },
      take: 500,
    }),
    prisma.sfTechProfile.findMany({
      select: { userId: true, calendarMailbox: true, calendarSyncEnabled: true },
    }),
    // Blocks currently mirrored, plus the most recent failure per mailbox, so a
    // calendar that has quietly stopped updating is visible here.
    prisma.sfCalendarLink.findMany({
      select: { mailbox: true, lastError: true, syncedAt: true },
      orderBy: { syncedAt: "desc" },
      take: 2000,
    }),
  ]);
  const usageByCode = new Map(chargeCodeUsage.map((u) => [u.chargeCodeId, u._count._all]));
  const profileByUser = new Map(techProfiles.map((p) => [p.userId, p]));
  const linkStats = new Map<string, { count: number; lastError: string | null }>();
  for (const link of syncedLinks) {
    const stat = linkStats.get(link.mailbox) ?? { count: 0, lastError: null };
    stat.count += 1;
    // Ordered newest first, so the first error encountered is the latest one.
    if (!stat.lastError && link.lastError) stat.lastError = link.lastError;
    linkStats.set(link.mailbox, stat);
  }
  const techProfileRows: TechProfileRow[] = techUsers.map((u) => {
    const profile = profileByUser.get(u.id);
    const stat = profile?.calendarMailbox ? linkStats.get(profile.calendarMailbox) : undefined;
    return {
      userId: u.id,
      name: u.name ?? "",
      email: u.email,
      calendarMailbox: profile?.calendarMailbox ?? null,
      calendarSyncEnabled: profile?.calendarSyncEnabled ?? false,
      syncedBlocks: stat?.count ?? 0,
      lastError: stat?.lastError ?? null,
    };
  });
  const clientNames = new Map(setupClients.map((c) => [c.id, c.name]));
  const setupAgreements = setupAgreementRows.map((a) => ({
    id: a.id,
    label: `${a.client.name} — ${a.name}`,
  }));
  const chargeCodeRows: ChargeCodeRow[] = chargeCodes.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    kind: c.kind,
    billableDefault: c.billableDefault,
    defaultMultiplier: c.defaultMultiplier != null ? Number(c.defaultMultiplier) : null,
    sortOrder: c.sortOrder,
    active: c.active,
    inUse: usageByCode.get(c.id) ?? 0,
  }));
  const rateRuleRows: RateRuleRow[] = rateRules.map((r) => ({
    id: r.id,
    scope: r.scope,
    client: r.clientId ? (clientNames.get(r.clientId) ?? "Unknown client") : null,
    agreement: r.agreement?.name ?? null,
    chargeCode: r.chargeCode?.code ?? null,
    timeBand: r.timeBand,
    fixedRate: r.fixedRate != null ? Number(r.fixedRate) : null,
    multiplier: r.multiplier != null ? Number(r.multiplier) : null,
    costRate: r.costRate != null ? Number(r.costRate) : null,
    active: r.active,
  }));
  const sla = slas[0] ?? null;
  const empty = boards.length === 0 && slas.length === 0 && chargeCodes.length === 0;

  return (
    <div>
      <PageHeader
        help={<PawTip topic="setup" />}
        title="SilverFang Setup"
        description="Boards, statuses, SLAs, business hours, charge codes and rates."
        actions={<SeedButton />}
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Module</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <StatItem label="Tickets" value={tickets} />
            <StatItem label="Contacts" value={contacts} />
            <StatItem label="Agreements" value={agreements} />
            <StatItem label="Projects" value={projects} />
            <StatItem label="Time entries" value={timeEntries} />
          </div>
        </Card>

        {empty ? (
          <EmptyState
            title="Nothing configured yet"
            description="Click “Create defaults” to set up the Service Desk board with a ConnectWise-style status flow, a standard SLA with business hours, and the standard charge codes."
          />
        ) : (
          <>
            {/* Boards + statuses */}
            <Card>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">Boards ({boards.length}) <PawTip topic="boardSetup" /></h2>
              {boards.length === 0 ? (
                <p className="text-sm text-muted-foreground">No boards yet.</p>
              ) : (
                <div className="space-y-4">
                  {boards.map((b) => (
                    <div key={b.id} className="rounded-md border p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{b.name}</span>
                        {!b.active && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs">inactive</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          SLA: {b.sla?.name ?? "none"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {b.statuses.map((s) => (
                          <span
                            key={s.id}
                            className={`rounded-full border px-2 py-0.5 text-xs ${
                              s.isClosed
                                ? "text-muted-foreground"
                                : s.stopsSlaClock
                                  ? "border-warning/40 text-warning"
                                  : ""
                            }`}
                            title={
                              s.stopsSlaClock
                                ? "Pauses the SLA clock"
                                : s.isClosed
                                  ? "Closed status"
                                  : "Open status"
                            }
                          >
                            {s.name}
                            {s.isDefault && " ★"}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        ★ default for new tickets · amber statuses pause the SLA clock
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* SLAs */}
            <Card>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">SLAs ({slas.length}) <PawTip topic="slaSetup" /></h2>
              {slas.length === 0 ? (
                <p className="text-sm text-muted-foreground">No SLAs yet.</p>
              ) : (
                <div className="space-y-4">
                  {slas.map((s) => (
                    <div key={s.id} className="rounded-md border p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {s.useBusinessHours ? "business hours" : "24/7 calendar time"}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-left text-xs uppercase text-muted-foreground">
                            <tr>
                              <th className="py-1 pr-4 font-medium">Priority</th>
                              <th className="py-1 pr-4 font-medium">Response</th>
                              <th className="py-1 pr-4 font-medium">Resolution</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(["P1", "P2", "P3", "P4"] as const).map((p) => {
                              const resp = s.targets.find(
                                (t) => t.priority === p && t.kind === "RESPONSE",
                              );
                              const res = s.targets.find(
                                (t) => t.priority === p && t.kind === "RESOLUTION",
                              );
                              return (
                                <tr key={p} className="border-t">
                                  <td className="py-1 pr-4">{PRIORITY_LABELS[p]}</td>
                                  <td className="py-1 pr-4 tabular-nums">
                                    {resp ? `${resp.minutes} min` : "—"}
                                  </td>
                                  <td className="py-1 pr-4 tabular-nums">
                                    {res ? `${res.minutes} min` : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Business hours:{" "}
                        {s.businessHours.length === 0
                          ? "not configured (targets fall back to elapsed time)"
                          : s.businessHours
                              .map(
                                (w) =>
                                  `${WEEKDAYS[w.weekday]} ${minutesToTime(w.startMinute)}–${minutesToTime(w.endMinute)}`,
                              )
                              .join(", ")}
                        {s.businessHours[0] ? ` (${s.businessHours[0].timezone})` : ""}
                      </p>
                      {s.holidays.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {s.holidays.length} holiday{s.holidays.length === 1 ? "" : "s"} configured
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Charge codes */}
            <Card>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">Charge codes ({chargeCodes.length}) <PawTip topic="chargeCodes" /></h2>
              {chargeCodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No charge codes yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-4 font-medium">Code</th>
                        <th className="py-1 pr-4 font-medium">Name</th>
                        <th className="py-1 pr-4 font-medium">Kind</th>
                        <th className="py-1 pr-4 font-medium">Billable by default</th>
                        <th className="py-1 pr-4 font-medium">Multiplier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chargeCodes.map((c) => (
                        <tr key={c.id} className="border-t">
                          <td className="py-1.5 pr-4 font-mono text-xs">{c.code}</td>
                          <td className="py-1.5 pr-4">{c.name}</td>
                          <td className="py-1.5 pr-4">{CHARGE_CODE_KIND_LABELS[c.kind]}</td>
                          <td className="py-1.5 pr-4">{c.billableDefault ? "Yes" : "No"}</td>
                          <td className="py-1.5 pr-4 tabular-nums">
                            {c.defaultMultiplier != null ? `${Number(c.defaultMultiplier)}×` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Rate rules */}
            <Card>
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">Rate rules ({rateRules.length}) <PawTip topic="rateRules" /></h2>
              <p className="mb-3 text-xs text-muted-foreground">
                The most specific active rule wins (agreement+code → agreement → client+code →
                client → code → global). A fixed rate beats a multiplier; a band-specific rule beats
                an any-time rule.
              </p>
              {rateRules.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rate rules yet — time falls back to the agreement standard rate, then the
                  technician&apos;s bill rate, and is flagged if neither exists.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-4 font-medium">Scope</th>
                        <th className="py-1 pr-4 font-medium">Charge code</th>
                        <th className="py-1 pr-4 font-medium">Agreement</th>
                        <th className="py-1 pr-4 font-medium">When</th>
                        <th className="py-1 pr-4 text-right font-medium">Rate</th>
                        <th className="py-1 pr-4 text-right font-medium">Multiplier</th>
                        <th className="py-1 pr-4 font-medium">Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rateRules.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="py-1.5 pr-4">{r.scope}</td>
                          <td className="py-1.5 pr-4">{r.chargeCode?.code ?? "—"}</td>
                          <td className="py-1.5 pr-4">{r.agreement?.name ?? "—"}</td>
                          <td className="py-1.5 pr-4">{TIME_BAND_LABELS[r.timeBand]}</td>
                          <td className="py-1.5 pr-4 text-right tabular-nums">
                            {r.fixedRate != null ? formatCurrency(Number(r.fixedRate)) : "—"}
                          </td>
                          <td className="py-1.5 pr-4 text-right tabular-nums">
                            {r.multiplier != null ? `${Number(r.multiplier)}×` : "—"}
                          </td>
                          <td className="py-1.5 pr-4">{r.active ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}

        {/* Configuration editors */}
        <Card>
          <h2 className="mb-1 text-sm font-semibold">Charge codes</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            What kind of work a time entry is, and whether it bills by default.
          </p>
          <ChargeCodeEditor codes={chargeCodeRows} />
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-semibold">Technician calendars</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Mirror scheduled time blocks onto a technician&rsquo;s Outlook calendar. One-way:
            Wolf365 is the record, so an event edited in Outlook is overwritten on the next sync.
            Only blocks with a start <em>and</em> end time become events — time logged as a
            duration has no place to sit on a calendar. Off per person by default, because
            writing to somebody&rsquo;s calendar is not a company-wide switch.
          </p>
          <p className="mb-3 rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2 text-xs">
            Needs the <span className="font-mono">Calendars.ReadWrite</span> application
            permission in Entra, and the app&rsquo;s mailbox access scope must include these
            mailboxes — the SilverFang mail scope covers the shared mailboxes only. Without
            both, sync fails with 403 and the reason is shown against the technician.
          </p>
          <TechProfiles rows={techProfileRows} />
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-semibold">Rate rules</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            How logged time gets a value. Without a matching rule, an agreement&rsquo;s standard
            rate or the technician&rsquo;s own rate is used — and if neither exists, the entry has
            no value and says so rather than inventing one.
          </p>
          <RateRuleEditor
            rules={rateRuleRows}
            clients={setupClients}
            agreements={setupAgreements}
            chargeCodes={chargeCodeRows.map((c) => ({ id: c.id, code: c.code }))}
          />
        </Card>

        {sla && (
          <>
            <Card>
              <h2 className="mb-1 text-sm font-semibold">SLA targets — {sla.name}</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Response and resolution targets per priority, in business minutes.
              </p>
              <SlaTargetEditor
                slaId={sla.id}
                targets={sla.targets.map((t) => ({
                  priority: t.priority,
                  kind: t.kind,
                  minutes: t.minutes,
                }))}
              />
            </Card>

            <Card>
              <h2 className="mb-1 text-sm font-semibold">Business hours &amp; holidays</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                The only time the SLA clock counts. Holidays stop it for the whole day.
              </p>
              <CalendarEditor
                slaId={sla.id}
                weekdays={sla.businessHours.map((w) => w.weekday)}
                startMinute={sla.businessHours[0]?.startMinute ?? 480}
                endMinute={sla.businessHours[0]?.endMinute ?? 1020}
                timezone={sla.businessHours[0]?.timezone ?? "America/Winnipeg"}
                holidays={sla.holidays.map((h) => ({
                  id: h.id,
                  name: h.name,
                  date: h.date.toISOString().slice(0, 10),
                }))}
              />
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
