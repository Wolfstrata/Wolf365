/**
 * The help text behind every silver paw in SilverFang.
 *
 * Plain data, in one place, so the copy can be read and corrected without hunting
 * through pages — and so a test can assert every topic a page asks for actually
 * exists. A tooltip that renders empty is worse than no tooltip: it looks broken
 * and teaches people to stop hovering.
 *
 * Written to answer two questions, in this order: *what is this screen for*, and
 * *what do I need to do here*. Not a description of the widgets, which people can
 * already see.
 */

export interface HelpTopic {
  title: string;
  /** One or two short paragraphs. Kept terse — this is a hover, not a manual. */
  body: string;
  /** The concrete next action, when there is one. */
  todo?: string;
}

export const HELP_TOPICS: Record<string, HelpTopic> = {
  dashboard: {
    title: "SilverFang Dashboard",
    body: "Queue health at a glance. The tiles at the top are your boards — click one to work that queue. SLA figures are measured in business hours, not wall-clock, so a Friday-evening ticket is not judged against the weekend.",
    todo: "Start with anything under “SLA at risk” — those can still be saved. “Breached” has already happened.",
  },
  boards: {
    title: "Boards",
    body: "Boards group work by kind, not by person: MSA covers agreement work (managed services, NOC, prepaid blocks), Projects holds scoped project tickets, and Service Desk catches ad-hoc requests with no agreement behind them.",
    todo: "A per-person board turns a queue into an inbox nobody else picks up from — that is why they are organised this way.",
  },
  tickets: {
    title: "Tickets",
    body: "Every request, across all boards. The order is deliberate: priority first, then VIP requesters, then oldest first — the oldest ticket at a given priority is the one closest to breaching, so it is the one to pick up.",
    todo: "Tick several tickets to move them between boards or onto a project in one go.",
  },
  myTickets: {
    title: "My Tickets",
    body: "Only what is assigned to you, in the same priority order as the main queue.",
    todo: "If this is empty and the main queue is not, nothing has been assigned to you yet — assign from the ticket, or ask whoever triages.",
  },
  ticketDetail: {
    title: "Working a ticket",
    body: "The activity feed merges notes, email and field history in one thread, newest first. Time logged here rolls up to the client, the agreement and any project the ticket belongs to.",
    todo: "Replying by email needs two things on: the master outbound switch, and “Allow email to client” on that specific client. Internal notes are never emailed.",
  },
  clients: {
    title: "Clients",
    body: "Wolf365 clients as SilverFang sees them — tickets, contacts, agreements and projects for each. This is the same client record the rest of Wolf365 uses, so there is one identity per company.",
    todo: "Open a client to set its default board, its account manager, and whether it may be emailed.",
  },
  contacts: {
    title: "Contacts",
    body: "The people who raise tickets. The email address matters most: inbound mail is matched to a client by its sender, so a contact without one cannot be recognised automatically. A sender on a known company domain is matched to that client and a contact is created for them.",
    todo: "Mark someone VIP to lift their tickets above others at the same priority. It never outranks priority itself.",
  },
  time: {
    title: "Time Entries",
    body: "Log work in quarter-hour blocks. Date and time are optional — leave them and it stamps now. A block with a start and end time also appears on your Outlook calendar if calendar sync is on for you.",
    todo: "Time must be approved before it can be billed. Unapproved hours show in utilisation but not in what is invoiceable.",
  },
  timesheets: {
    title: "Timesheets",
    body: "A week of your time entries, submitted as one thing for approval. Approving locks the entries so later rate changes cannot rewrite history.",
    todo: "Submit at the end of the week; anything unapproved stays out of billing.",
  },
  agreements: {
    title: "Agreements",
    body: "What a client has bought: managed services with included hours, a NOC agreement, or prepaid block time. Included hours are consumed oldest-work-first; hours beyond them become overage on the next invoice.",
    todo: "Ticking auto-renew is the consent — the agreement then renews itself on its end date with the uplift applied, and every renewal is audited.",
  },
  unknownSenders: {
    title: "Unrecognised senders",
    body: "People who emailed and got no ticket, because nobody holds their address and no other contact shares their domain. Grouped per person, not per message — someone who gets no reply emails again, and the fix is one decision per person.",
    todo: "Pick the client and press Add contact; the address is all that's needed, the name comes from it. Their next email opens a ticket. The refused messages aren't retried — the mailbox poll has already moved past them.",
  },
  authorizedTechs: {
    title: "Authorised technicians",
    body: "A per-agreement and per-project whitelist of who may log time. It exists to stop a tech drawing down the wrong client's prepaid block by accident. An empty list means everyone — the restriction only exists once you name somebody.",
    todo: "Anyone left off still sees the agreement or project and can read every detail; the row is greyed and time is refused. Editing the list itself is never restricted, so you can never lock it permanently.",
  },
  managedAgreements: {
    title: "Tag managed customers",
    body: "SuperOps has no managed-services flag, so this reads the client stage, status and contract names for the word \"managed\", then creates one draft 12-month agreement per match starting today. A client labelled \"unmanaged\" is excluded even if a contract says otherwise.",
    todo: "Check the preview before pressing the button. What it creates is a draft with no amounts — drafts can't bill, so open each one, fill in the money, and set it Active.",
  },
  projects: {
    title: "Projects",
    body: "Scoped work with phases, hours and its own budget. Phases hold tickets and hours that sum to the project total. A fixed-fee project tracks hours identically but never shows them to the client.",
    todo: "Open a project to add phases, raise project tickets against a phase, or save the whole thing as a reusable template.",
  },
  projectTemplates: {
    title: "Project templates",
    body: "A reusable project shape — phases, tasks and ticket stubs — with no client attached. Build one from scratch, or save an existing project as a template to reuse how it was structured.",
    todo: "Generating a project from a template creates its phases, tasks and tickets in one step; you fill in the client and the dates.",
  },
  reports: {
    title: "Service reporting",
    body: "Three questions in the order they matter: are the techs busy (utilisation), did we get paid for it (realisation), and was it worth doing (margin). Utilisation without realisation flatters you — a tech can be fully utilised on hours all absorbed by an agreement.",
    todo: "Billable hours with no rate at all are the ones to chase: those are hours nobody priced, which is different from hours somebody decided to give away.",
  },
  billing: {
    title: "SilverFang Billing",
    body: "Turns approved time, agreement fees, prepaid blocks and project fees into a reviewable run, then pushes it to QuickBooks as one invoice. Nothing is ever pushed automatically — a person has to approve it and press the button.",
    todo: "A line with no QuickBooks item is skipped at push and the run finishes PARTIALLY FAILED. Nothing is silently dropped, but nothing is billed for it either — map the item first.",
  },
  email: {
    title: "Email",
    body: "How tickets receive and send mail. Replies thread by the [SF-1042] subject tag first, backed by a header we stamp. Auto-replies and out-of-office never open a ticket or trigger a response, so two robots cannot mail each other in a loop.",
    todo: "Two gates must both be on before a client can be emailed: the master switch here, and “Allow email to client” on that client. Off is the default.",
  },
  setup: {
    title: "SilverFang Setup",
    body: "Boards and their statuses, SLA targets and business hours, charge codes, rate rules and per-technician settings. “Create defaults” is safe to re-run — it only adds what is missing.",
    todo: "Rate rules decide what logged time is worth. Without a matching rule an entry has no value and says so rather than inventing one.",
  },
};

/** Look up a topic. Returns null for an unknown id so the paw renders nothing. */
export function helpTopic(id: string): HelpTopic | null {
  return HELP_TOPICS[id] ?? null;
}

export type HelpTopicId = keyof typeof HELP_TOPICS;
