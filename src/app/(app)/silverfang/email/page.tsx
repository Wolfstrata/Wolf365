import { Check, Inbox, TriangleAlert, X } from "lucide-react";
import { prisma } from "@/lib/db";
import { getEnv } from "@/env";
import { requirePermission } from "@/lib/auth/session";
import { graphConfigured } from "@/lib/crm/graph";
import { PageHeader, Card, StatItem } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/local-time";
import { PRIORITY_LABELS } from "@/lib/silverfang/constants";
import { TEMPLATE_VARIABLES, TICKET_HEADER } from "@/lib/silverfang/email";
import { outboundEnabled } from "@/lib/silverfang/email-policy";
import { SETTLED_DECISIONS } from "@/lib/silverfang/ingest-outcomes";
import { INTERNAL_ONLY_RULE_TRIGGERS } from "@/lib/silverfang/auto-response-triggers";
import { textRead } from "@/lib/silverfang/pii";
import { POLICY_ID } from "@/lib/silverfang/mail";
import { MailEvents, type MailEventRow } from "./mail-events";
import { toggleAutoResponseAction } from "../actions";
import { MailboxForm, type MailboxValues } from "./mailbox-form";
import { DiagnoseMail } from "./diagnose";
import { EmailMasterSwitch } from "./master-switch";
import { PollMailboxesButton } from "./poll-button";

export const dynamic = "force-dynamic";

const BLANK: MailboxValues = {
  address: "",
  name: "",
  sendAsAddress: "",
  ignoreBeforeIso: null,
  boardId: "",
  fallbackClientId: "",
  defaultPriority: "P3",
  provider: "GRAPH",
  inbound: true,
  outbound: true,
  active: true,
  signature: "",
};

function Yes({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-sm ${ok ? "text-success" : "text-muted-foreground"}`}>
      {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

/**
 * SilverFang email configuration: which mailboxes we send from and poll, how
 * inbound mail can reach us, and the auto-response rules.
 */
export default async function SilverFangEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ mail?: string }>;
}) {
  await requirePermission("silverfang:configure");
  const env = getEnv();
  // Default to the problems: on a healthy install almost every row is a
  // deliberate skip, and burying the two that matter under fifty that don't is
  // how this stayed invisible in the first place.
  const showAllMail = (await searchParams).mail === "all";

  const [mailboxes, boards, clients, rules, graphReady, inboundCount] = await Promise.all([
    prisma.sfMailbox.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      include: {
        board: { select: { name: true } },
        fallbackClient: { select: { name: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.sfBoard.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.client.findMany({
      where: { archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 2000,
    }),
    prisma.sfAutoResponseRule.findMany({ orderBy: [{ trigger: "asc" }, { name: "asc" }] }),
    graphConfigured(),
    prisma.sfTicketMessage.count({ where: { direction: "INBOUND" } }),
  ]);

  // The gate is the most consequential setting on this page, so it is stated
  // here rather than only on individual clients.
  const [emailableClients, totalClients, policy] = await Promise.all([
    prisma.client.count({
      where: { archived: false, sfClientProfile: { allowClientEmail: true } },
    }),
    prisma.client.count({ where: { archived: false } }),
    prisma.sfEmailPolicy.findUnique({
      where: { id: POLICY_ID },
      select: { outboundEnabled: true, updatedByEmail: true },
    }),
  ]);
  const masterOn = outboundEnabled(policy);

  const outboundCount = await prisma.sfTicketMessage.count({ where: { direction: "OUTBOUND" } });

  // Recent inbound decisions. Filtered by excluding the settled outcomes rather
  // than by listing the problems, so an outcome this build does not know about
  // still surfaces instead of passing as fine.
  const [mailEventRows, mailProblemCount] = await Promise.all([
    prisma.sfMailEvent.findMany({
      where: showAllMail ? {} : { decision: { notIn: SETTLED_DECISIONS } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        mailbox: { select: { address: true } },
        ticket: { select: { id: true, number: true } },
      },
    }),
    prisma.sfMailEvent.count({ where: { decision: { notIn: SETTLED_DECISIONS } } }),
  ]);
  const mailEvents: MailEventRow[] = mailEventRows.map((e) => ({
    id: e.id,
    decision: e.decision,
    detail: e.detail,
    // Stored encrypted, like every other address in the system.
    fromAddress: textRead(e.fromAddress),
    subject: e.subject,
    mailbox: e.mailbox?.address ?? null,
    ticketId: e.ticket?.id ?? null,
    ticketNumber: e.ticket?.number ?? null,
    at: e.receivedAt ?? e.createdAt,
  }));
  const webhookUrl = env.AUTH_URL
    ? `${env.AUTH_URL.replace(/\/$/, "")}/api/silverfang/email`
    : "/api/silverfang/email";

  return (
    <div>
      <PageHeader
        title="Email"
        description="Support mailboxes, inbound routing and auto-responses for SilverFang tickets."
        actions={<PollMailboxesButton />}
      />
      <div className="space-y-6 p-4 sm:p-8">
        <EmailMasterSwitch
          enabled={masterOn}
          updatedByEmail={policy?.updatedByEmail ?? null}
          emailableClients={emailableClients}
        />

        {/* What is wired up */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Configuration</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatItem label="Mailboxes" value={mailboxes.filter((m) => m.active).length} />
            <StatItem label="Emails received" value={inboundCount} />
            <StatItem label="Emails sent" value={outboundCount} />
            <StatItem
              label="Microsoft Graph"
              value={<Yes ok={graphReady} label={graphReady ? "Ready" : "Not configured"} />}
            />
            <StatItem
              label="Outbound email"
              value={
                masterOn ? (
                  <span className="text-success">On</span>
                ) : (
                  <span className="text-danger">Off — nothing sent</span>
                )
              }
            />
            <StatItem
              label="Clients emailable"
              value={
                emailableClients === 0 ? (
                  <span className="text-warning">0 of {totalClients}</span>
                ) : (
                  <span className="text-success">
                    {emailableClients} of {totalClients}
                  </span>
                )
              }
            />
            <StatItem
              label="Resend"
              value={
                <Yes
                  ok={Boolean(env.RESEND_API_KEY)}
                  label={env.RESEND_API_KEY ? "Ready" : "No API key"}
                />
              }
            />
          </div>
          <div className="mt-4 space-y-2 border-t pt-4 text-xs text-muted-foreground">
            <p className="rounded-md border border-warning/40 bg-warning/5 p-2.5">
              <span className="font-medium text-foreground">
                Two gates, both of which must be on: the master switch above, and
                &ldquo;Allow email to client&rdquo; for the individual client.
              </span>{" "}
              “Allow email to client” lives on each client&rsquo;s SilverFang profile and is off
              by default — for every client, including new ones, permanently. Replies and
              auto-responses to a client that is off are refused and say so; nothing is queued
              or sent later. Internal mail to technicians and all inbound email are unaffected.
              {emailableClients === 0 &&
                " Right now no client can be emailed at all, so nothing can go out."}
            </p>
            <p>
              <span className="font-medium text-foreground">Receiving mail.</span> A Microsoft 365
              mailbox is polled every 15 minutes (and by “Check mail now”). This needs{" "}
              <span className="font-mono">Mail.ReadWrite</span> and{" "}
              <span className="font-mono">Mail.Send</span> <em>application</em> permissions
              consented on the same Entra app registration used for sign-in.
              {!graphReady && " Entra SSO is not configured yet, so polling cannot run."}
            </p>
            <p>
              <span className="font-medium text-foreground">Or forward to the webhook.</span> POST
              messages to <span className="font-mono">{webhookUrl}</span> with{" "}
              <span className="font-mono">Authorization: Bearer …</span>.{" "}
              {env.WOLF365_SILVERFANG_EMAIL_TOKEN ? (
                <span className="text-success">
                  A token is configured, so the endpoint is live.
                </span>
              ) : (
                <span className="text-warning">
                  Set WOLF365_SILVERFANG_EMAIL_TOKEN to enable it — it refuses every request until
                  then.
                </span>
              )}
            </p>
            <p>
              <span className="font-medium text-foreground">Threading.</span> Replies are matched by
              the <span className="font-mono">[SF-1042]</span> tag in the subject, backed by the{" "}
              <span className="font-mono">{TICKET_HEADER}</span> header we stamp on outbound mail,
              then by In-Reply-To/References. A reply to a closed ticket reopens it; a reply while
              “waiting on client” resumes the SLA clock.
            </p>
          </div>
        </Card>

        <DiagnoseMail />

        {/* What happened to inbound mail */}
        <Card>
          <h2 className="mb-1 text-sm font-semibold">Inbound mail activity</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Every message the ingest decided on. Nothing is dropped silently — a message
            that did not become a ticket says which of the reasons applied, and whether
            that was deliberate or something to fix.
          </p>
          <MailEvents events={mailEvents} problems={mailProblemCount} showAll={showAllMail} />
        </Card>

        {/* Mailboxes */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Mailboxes ({mailboxes.length})</h2>
          {mailboxes.length === 0 ? (
            <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Inbox className="h-4 w-4" />
              No mailbox yet — tickets cannot send or receive email until one exists.
            </p>
          ) : (
            <div className="mb-6 space-y-4">
              {mailboxes.map((m) => (
                <details key={m.id} className="rounded-md border">
                  <summary className="cursor-pointer list-none p-3">
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="font-medium">{m.address}</span>
                      {m.name && <span className="text-muted-foreground">{m.name}</span>}
                      {m.sendAsAddress && (
                        <span className="text-muted-foreground">
                          replies as <span className="font-medium">{m.sendAsAddress}</span>
                        </span>
                      )}
                      <span className="rounded-full border px-2 py-0.5 text-xs">{m.provider}</span>
                      {!m.active && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          Inactive
                        </span>
                      )}
                      {m.inbound && (
                        <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
                          Receives
                        </span>
                      )}
                      {m.outbound && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                          Sends
                        </span>
                      )}
                      {m.lastPollError && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-xs text-danger">
                          <TriangleAlert className="h-3 w-3" /> Last poll failed
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-4">
                      <span>Board: {m.board?.name ?? "Default"}</span>
                      <span>Priority: {PRIORITY_LABELS[m.defaultPriority]}</span>
                      <span>
                        Unknown senders:{" "}
                        {m.fallbackClient ? m.fallbackClient.name : "refused and reported"}
                      </span>
                      <span>Messages: {m._count.messages}</span>
                      <span>
                        Last polled:{" "}
                        {m.lastPolledAt ? <LocalTime value={m.lastPolledAt.toISOString()} /> : "never"}
                      </span>
                      <span>
                        Newest mail seen:{" "}
                        {m.lastMessageAt ? (
                          <LocalTime value={m.lastMessageAt.toISOString()} />
                        ) : (
                          "none yet"
                        )}
                      </span>
                    </div>
                    {m.lastPollError && (
                      <p className="mt-2 text-xs text-danger">{m.lastPollError}</p>
                    )}
                  </summary>
                  <div className="border-t p-3">
                    <MailboxForm
                      values={{
                        id: m.id,
                        address: m.address,
                        name: m.name ?? "",
                        sendAsAddress: m.sendAsAddress ?? "",
                        ignoreBeforeIso: m.ignoreBefore?.toISOString() ?? null,
                        boardId: m.boardId ?? "",
                        fallbackClientId: m.fallbackClientId ?? "",
                        defaultPriority: m.defaultPriority,
                        provider: m.provider,
                        inbound: m.inbound,
                        outbound: m.outbound,
                        active: m.active,
                        signature: m.signature ?? "",
                      }}
                      boards={boards}
                      clients={clients}
                      submitLabel="Save changes"
                    />
                  </div>
                </details>
              ))}
            </div>
          )}

          <details className="rounded-md border" open={mailboxes.length === 0}>
            <summary className="cursor-pointer p-3 text-sm font-medium">Add a mailbox</summary>
            <div className="border-t p-3">
              <MailboxForm
                values={BLANK}
                boards={boards}
                clients={clients}
                submitLabel="Add mailbox"
              />
            </div>
          </details>
        </Card>

        {/* Auto-responses */}
        <Card>
          <h2 className="mb-1 text-sm font-semibold">Auto-responses ({rules.length})</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Templated mail sent when something happens on a ticket. Seeded switched{" "}
            <span className="font-medium">off</span> — nothing reaches a client until you enable it.
            Auto-replies and out-of-office mail never trigger a rule, so two robots cannot mail each
            other in a loop. Rules marked{" "}
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">internal only</span>{" "}
            never mail a client whatever their audience says — those are the SLA alerts, and they
            are safe to switch on. Placeholders:{" "}
            <span className="font-mono">
              {TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(" ")}
            </span>
          </p>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rules yet — run SilverFang Setup to seed the starter templates.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4 font-medium">Rule</th>
                    <th className="py-1 pr-4 font-medium">Trigger</th>
                    <th className="py-1 pr-4 font-medium">Audience</th>
                    <th className="py-1 pr-4 font-medium">Subject</th>
                    <th className="py-1 pr-4 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className="border-t align-top">
                      <td className="py-2 pr-4 font-medium">{r.name}</td>
                      <td className="py-2 pr-4">{r.trigger}</td>
                      <td className="py-2 pr-4">
                        {r.audience}
                        {/* An internal-only trigger cannot reach a client whatever
                            the audience says, so "off by default" is over-cautious
                            here — and an alert nobody enabled is an alert nobody
                            gets. Say so on the row. */}
                        {INTERNAL_ONLY_RULE_TRIGGERS.includes(r.trigger) && (
                          <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            internal only
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.subjectTemplate}</td>
                      <td className="py-2 pr-4">
                        <form action={toggleAutoResponseAction} className="flex items-center gap-2">
                          <input type="hidden" name="ruleId" value={r.id} />
                          <span
                            className={
                              r.active ? "font-medium text-success" : "text-muted-foreground"
                            }
                          >
                            {r.active ? "On" : "Off"}
                          </span>
                          <button className="rounded-md border px-2 py-1 text-xs font-medium transition hover:bg-accent">
                            {r.active ? "Turn off" : "Turn on"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
