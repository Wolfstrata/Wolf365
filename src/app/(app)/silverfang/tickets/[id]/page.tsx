import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, Mail, MailOpen, Pencil } from "lucide-react";
import { prisma } from "@/lib/db";
import { textRead } from "@/lib/silverfang/pii";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem } from "@/components/ui/primitives";
import { PawTip } from "@/components/ui/paw-tip";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { safeReturnTo, withReturnTo } from "@/lib/silverfang/return-to";
import { LocalTime } from "@/components/ui/local-time";
import { PRIORITY_LABELS, PRIORITY_STYLES, SOURCE_LABELS } from "@/lib/silverfang/constants";
import { formatHours } from "@/lib/silverfang/time";
import { timeEntryEditable } from "@/lib/silverfang/status";
import { evaluateTarget } from "@/lib/silverfang/sla";
import { loadSla } from "@/lib/silverfang/service";
import { defaultReplyRecipients } from "@/lib/silverfang/email-send";
import { clientEmailAllowed, outboundEnabled } from "@/lib/silverfang/email-policy";
import { POLICY_ID } from "@/lib/silverfang/mail";
import { setTicketStatusAction, assignTicketAction } from "../../actions";
import { EmailForm } from "./email-form";
import { NoteForm } from "./note-form";
import { TimeCard, type TimeEntryRow } from "./time-card";
import { TicketHuduPanel } from "./hudu-panel";

export const dynamic = "force-dynamic";

/** SLA banner for one target. */
function SlaBadge({
  label,
  dueAt,
  state,
  metAt,
}: {
  label: string;
  dueAt: Date | null;
  state: { breached: boolean; atRisk: boolean; remainingMinutes: number | null };
  metAt: Date | null;
}) {
  if (dueAt == null) {
    return <StatItem label={label} value={<span className="text-muted-foreground">No target</span>} />;
  }
  const cls = state.breached
    ? "text-danger"
    : state.atRisk
      ? "text-warning"
      : metAt
        ? "text-success"
        : "";
  const suffix = metAt
    ? state.breached
      ? " (late)"
      : " (met)"
    : state.breached
      ? " (breached)"
      : state.atRisk
        ? " (at risk)"
        : "";
  return (
    <StatItem
      label={label}
      value={
        <span className={cls}>
          <LocalTime value={dueAt.toISOString()} />
          {suffix}
        </span>
      }
    />
  );
}

export default async function TicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "tickets:read")) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  const ticket = await prisma.sfTicket.findUnique({
    where: { id },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          sfClientProfile: { select: { allowClientEmail: true } },
        },
      },
      contact: true,
      board: { include: { statuses: { orderBy: { sortOrder: "asc" } } } },
      status: true,
      assignee: { select: { id: true, name: true, email: true } },
      agreement: { select: { id: true, name: true, type: true } },
      project: { select: { id: true, name: true } },
      projectPhase: { select: { id: true, name: true } },
      notes: { orderBy: { createdAt: "desc" } },
      messages: { orderBy: { createdAt: "desc" }, take: 100 },
      history: { orderBy: { createdAt: "desc" }, take: 50 },
      timeEntries: {
        orderBy: { workDate: "desc" },
        include: {
          chargeCode: { select: { code: true, name: true } },
          user: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!ticket) notFound();

  const [sla, chargeCodes, users, outboundMailbox, replyTo, emailPolicy] = await Promise.all([
    loadSla(ticket.slaId),
    prisma.sfChargeCode.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({
      where: { disabled: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    prisma.sfMailbox.findFirst({
      where: { active: true, outbound: true },
      orderBy: { createdAt: "asc" },
      select: { address: true },
    }),
    defaultReplyRecipients(id),
    prisma.sfEmailPolicy.findUnique({
      where: { id: POLICY_ID },
      select: { outboundEnabled: true },
    }),
  ]);

  const now = new Date();
  const responseState = sla
    ? evaluateTarget(sla, ticket.priority, "RESPONSE", ticket.openedAt, now, {
        metAt: ticket.firstRespondedAt,
        pausedMinutes: ticket.slaPausedMinutes,
      })
    : { breached: false, atRisk: false, remainingMinutes: null };
  const resolutionState = sla
    ? evaluateTarget(sla, ticket.priority, "RESOLUTION", ticket.openedAt, now, {
        metAt: ticket.resolvedAt,
        pausedMinutes: ticket.slaPausedMinutes,
      })
    : { breached: false, atRisk: false, remainingMinutes: null };

  // Where this ticket sits, so both the trail and the Edit link know the way back.
  const crumbs: Crumb[] = [
    { label: "Clients", href: "/silverfang/clients" },
    { label: ticket.client.name, href: `/silverfang/clients/${ticket.client.id}` },
  ];
  if (ticket.project) {
    crumbs.push({ label: ticket.project.name, href: `/silverfang/projects/${ticket.project.id}` });
  }
  if (ticket.projectPhase) crumbs.push({ label: ticket.projectPhase.name });
  crumbs.push({ label: `#${ticket.number}` });
  // An explicit ?returnTo= wins — it is where the viewer actually came from — else
  // the ticket's own project or client, which is nearer than the global queue.
  const backTo =
    safeReturnTo(sp.returnTo) ??
    (ticket.project
      ? `/silverfang/projects/${ticket.project.id}`
      : `/silverfang/clients/${ticket.client.id}`);

  const canWrite = can(user.role, "tickets:write");
  const canAssign = can(user.role, "tickets:assign");
  const canLogTime = can(user.role, "time:log");
  const canApprove = can(user.role, "time:approve");

  const timeRows: TimeEntryRow[] = ticket.timeEntries.map((e) => ({
    id: e.id,
    workDate: e.workDate.toISOString(),
    hours: Number(e.hours),
    chargeCode: e.chargeCode.code,
    chargeCodeId: e.chargeCodeId,
    tech: e.user.name ?? e.user.email,
    billable: e.billable,
    internalOnly: e.internalOnly,
    notes: e.notes,
    rate: e.rate != null ? Number(e.rate) : null,
    amount: e.amount != null ? Number(e.amount) : null,
    status: e.status,
    timeBand: e.timeBand,
    // A tech may edit their own unapproved time; approvers may edit anyone's.
    editable: timeEntryEditable(e.status) && (e.userId === user.id || canApprove),
  }));
  const totalHours = timeRows.reduce((a, e) => a + e.hours, 0);
  const billableHours = timeRows.filter((e) => e.billable).reduce((a, e) => a + e.hours, 0);

  // Merge notes + email + history into one reverse-chronological activity feed.
  type Activity =
    | { kind: "note"; at: Date; body: string; internalOnly: boolean; author: string | null }
    | {
        kind: "email";
        at: Date;
        inbound: boolean;
        body: string;
        subject: string | null;
        author: string | null;
        recipients: string[];
      }
    | { kind: "history"; at: Date; field: string; from: string | null; to: string | null; author: string | null };
  const activity: Activity[] = [
    ...ticket.notes.map((n) => ({
      kind: "note" as const,
      at: n.createdAt,
      body: textRead(n.body) ?? "",
      internalOnly: n.internalOnly,
      author: n.authorEmail,
    })),
    ...ticket.messages.map((m) => ({
      kind: "email" as const,
      at: m.receivedAt ?? m.sentAt ?? m.createdAt,
      inbound: m.direction === "INBOUND",
      body: textRead(m.bodyText) ?? "(no text body)",
      subject: m.subject,
      author: textRead(m.fromAddress) ?? "(unknown sender)",
      recipients: m.toAddresses,
    })),
    ...ticket.history.map((h) => ({
      kind: "history" as const,
      at: h.createdAt,
      field: h.field,
      from: h.oldValue,
      to: h.newValue,
      author: h.changedByEmail,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div>
      <PageHeader
        help={<PawTip topic="ticketDetail" />}
        title={`#${ticket.number} — ${ticket.summary}`}
        description={`${ticket.client.name} · ${ticket.board.name}`}
        actions={
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PRIORITY_STYLES[ticket.priority]}`}
            >
              {PRIORITY_LABELS[ticket.priority]}
            </span>
            <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium">
              {ticket.status.name}
            </span>
            {canWrite && (
              <Link
                href={withReturnTo(`/silverfang/tickets/${ticket.id}/edit`, backTo)}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
              >
                <Pencil className="h-4 w-4" /> Edit
              </Link>
            )}
          </div>
        }
      />
      <div className="space-y-6 p-4 sm:p-8">
        {/* A trail rather than a single back-link: a project ticket reached from a
            phase used to offer only "Tickets", which is not where you came from. */}
        <Breadcrumbs items={crumbs} />

        {/* Summary + SLA */}
        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            <StatItem
              label="Client"
              value={
                <Link
                  href={`/silverfang/clients/${ticket.client.id}`}
                  className="text-primary hover:underline"
                >
                  {ticket.client.name}
                </Link>
              }
            />
            <StatItem
              label="Contact"
              value={
                ticket.contact
                  ? [ticket.contact.firstName, ticket.contact.lastName].filter(Boolean).join(" ")
                  : "—"
              }
            />
            <StatItem label="Assignee" value={ticket.assignee?.name ?? ticket.assignee?.email ?? "Unassigned"} />
            <StatItem label="Source" value={SOURCE_LABELS[ticket.source]} />
            <StatItem label="Opened" value={<LocalTime value={ticket.openedAt.toISOString()} />} />
            <StatItem
              label="Time logged"
              value={`${formatHours(totalHours)}${
                ticket.estimatedHours != null
                  ? ` / ${formatHours(Number(ticket.estimatedHours))} est.`
                  : ""
              }`}
            />
            <SlaBadge
              label="Response due"
              dueAt={ticket.responseDueAt}
              state={responseState}
              metAt={ticket.firstRespondedAt}
            />
            <SlaBadge
              label="Resolution due"
              dueAt={ticket.resolutionDueAt}
              state={resolutionState}
              metAt={ticket.resolvedAt}
            />
            <StatItem
              label="Agreement"
              value={
                ticket.agreement ? (
                  <Link
                    href={`/silverfang/agreements/${ticket.agreement.id}`}
                    className="text-primary hover:underline"
                  >
                    {ticket.agreement.name}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            {ticket.slaPausedAt && (
              <StatItem label="SLA clock" value={<span className="text-warning">Paused</span>} />
            )}
            {ticket.closedAt && (
              <StatItem label="Closed" value={<LocalTime value={ticket.closedAt.toISOString()} />} />
            )}
          </div>
          {ticket.description && (
            <div className="mt-4 border-t pt-4">
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Description
              </p>
              <p className="whitespace-pre-wrap text-sm">{textRead(ticket.description)}</p>
            </div>
          )}
        </Card>

        {/* What Hudu knows about this client — collapsed, and renders nothing
            when Hudu holds no company for them. */}
        <TicketHuduPanel clientId={ticket.clientId} />

        {/* Quick actions: status + assignment */}
        {(canWrite || canAssign) && (
          <Card className="flex flex-wrap items-end gap-4">
            {canWrite && (
              <form action={setTicketStatusAction} className="flex items-end gap-2">
                <input type="hidden" name="ticketId" value={ticket.id} />
                <label className="text-xs font-medium text-muted-foreground">
                  Status
                  <select
                    name="statusId"
                    defaultValue={ticket.statusId}
                    className="mt-1 block w-48 rounded-md border bg-background px-3 py-1.5 text-sm"
                  >
                    {ticket.board.statuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent">
                  Update
                </button>
              </form>
            )}
            {canAssign && (
              <form action={assignTicketAction} className="flex items-end gap-2">
                <input type="hidden" name="ticketId" value={ticket.id} />
                <label className="text-xs font-medium text-muted-foreground">
                  Assignee
                  <select
                    name="assigneeId"
                    defaultValue={ticket.assigneeId ?? ""}
                    className="mt-1 block w-56 rounded-md border bg-background px-3 py-1.5 text-sm"
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name ?? u.email}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent">
                  Assign
                </button>
              </form>
            )}
          </Card>
        )}

        {/* Time */}
        <TimeCard
          ticketId={ticket.id}
          entries={timeRows}
          chargeCodes={chargeCodes.map((c) => ({
            id: c.id,
            code: c.code,
            name: c.name,
            billableDefault: c.billableDefault,
          }))}
          canLog={canLogTime}
          totalHours={totalHours}
          billableHours={billableHours}
        />

        {/* Activity */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Activity ({activity.length})</h2>
          {canWrite && (
            <div className="mb-5 space-y-4 border-b pb-5">
              <NoteForm ticketId={ticket.id} />
              <div className="border-t pt-4">
                <EmailForm
                  ticketId={ticket.id}
                  defaultTo={replyTo.join(", ")}
                  defaultSubject={ticket.summary}
                  mailbox={outboundMailbox?.address ?? null}
                  firstResponsePending={ticket.firstRespondedAt == null}
                  clientName={ticket.client.name}
                  clientEmailAllowed={clientEmailAllowed(ticket.client.sfClientProfile)}
                  masterEnabled={outboundEnabled(emailPolicy)}
                  clientHref={`/silverfang/clients/${ticket.client.id}`}
                />
              </div>
            </div>
          )}
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
          ) : (
            <ul className="space-y-3">
              {activity.map((a, i) => (
                <li
                  key={i}
                  className={`rounded-md border p-3 text-sm ${
                    a.kind === "note" && a.internalOnly
                      ? "border-warning/40 bg-warning/5"
                      : a.kind === "email"
                        ? "border-primary/30 bg-primary/5"
                        : ""
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <LocalTime value={a.at.toISOString()} />
                    {a.author && <span>· {a.author}</span>}
                    {a.kind === "note" && a.internalOnly && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 font-medium text-warning">
                        <Lock className="h-3 w-3" /> Internal only
                      </span>
                    )}
                    {a.kind === "note" && !a.internalOnly && (
                      <span className="rounded-full bg-success/15 px-1.5 py-0.5 font-medium text-success">
                        Client visible
                      </span>
                    )}
                    {a.kind === "email" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 font-medium text-primary">
                        {a.inbound ? (
                          <>
                            <MailOpen className="h-3 w-3" /> Email received
                          </>
                        ) : (
                          <>
                            <Mail className="h-3 w-3" /> Email sent
                          </>
                        )}
                      </span>
                    )}
                    {a.kind === "email" && a.recipients.length > 0 && (
                      <span>to {a.recipients.join(", ")}</span>
                    )}
                  </div>
                  {a.kind === "note" ? (
                    <p className="whitespace-pre-wrap">{a.body}</p>
                  ) : a.kind === "email" ? (
                    <>
                      {a.subject && <p className="mb-1 font-medium">{a.subject}</p>}
                      <p className="whitespace-pre-wrap">{a.body}</p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      Changed <span className="font-medium text-foreground">{a.field}</span>
                      {a.from ? ` from "${a.from}"` : ""}
                      {a.to ? ` to "${a.to}"` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
