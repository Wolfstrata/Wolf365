/**
 * The SilverFang manual, as data.
 *
 * Kept as structured content rather than as JSX so the page can build its own
 * contents list from it, and so a test can assert the shape (every section has an
 * id, a title and body) instead of trusting that nobody left a heading empty.
 *
 * Written to describe what the software actually does, including the parts that
 * surprise people — the permanent email default being OFF, block time never being
 * auto-selected, an empty authorised-tech list meaning everyone. Documentation
 * that only covers the happy path is what generates the questions.
 */

export interface DocBlock {
  /** A paragraph. */
  p?: string;
  /** A bulleted list. */
  list?: string[];
  /** A short sub-heading inside a section. */
  h?: string;
  /** A callout worth not missing. */
  note?: string;
}

export interface DocSection {
  id: string;
  title: string;
  /** One-line summary, shown in the contents. */
  summary: string;
  blocks: DocBlock[];
}

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "overview",
    title: "What SilverFang is",
    summary: "The service desk: tickets, time, agreements, projects.",
    blocks: [
      {
        p: "SilverFang is Wolf365's service desk. It holds the tickets your team works, the time they log against them, the agreements that decide what that time is worth, and the projects that group scoped work. It shares one client list with the rest of Wolf365, so a client you see in billing is the same record you raise a ticket against.",
      },
      {
        p: "Everything below is how the software behaves today. Where a behaviour is deliberate but surprising, it says so rather than leaving you to find out.",
      },
    ],
  },
  {
    id: "boards",
    title: "The three boards",
    summary: "MSA, Projects, Service Desk — organised by work, not by person.",
    blocks: [
      {
        p: "Tickets live on one of three boards, chosen by the kind of work rather than by who does it. A per-person board turns a queue into an inbox nobody else picks up from.",
      },
      {
        list: [
          "MSA — work under a managed services or managed NOC agreement.",
          "Projects — tickets belonging to a project phase.",
          "Service Desk — the catch-all: anything not managed and not project work.",
        ],
      },
      {
        p: "A new ticket is routed automatically: a project ticket opens on Projects, work under a managed agreement on MSA, everything else on Service Desk. A client with an explicitly configured default board overrides that for their ad-hoc work — but never for their project work, which always goes to Projects so a project's tickets stay together.",
      },
      {
        p: "Each board has its own copy of the status flow, because statuses belong to a board. Moving a ticket between boards remaps its status to the equivalent on the new board; a closed ticket is never reopened to make a move fit.",
      },
    ],
  },
  {
    id: "tickets",
    title: "Tickets",
    summary: "How they arrive, how they are ordered, and how to work a queue fast.",
    blocks: [
      { h: "How a ticket gets created" },
      {
        list: [
          "By hand, from New ticket. Opening it from a client, contact, agreement or project page pre-fills that context so you never re-pick what the app already knows.",
          "By email, when a support mailbox receives mail from a known contact — or from an unknown sender on a known client's domain.",
          "By a project template, which stamps out its ticket list when a project is generated from it.",
        ],
      },
      { h: "The order they appear in" },
      {
        p: "Every ticket list in the app uses the same order: priority first, then VIP requester, then oldest first, then ticket number. It is one comparator shared by every list, so two screens can never disagree about what is most urgent.",
      },
      {
        p: "A contact can be flagged VIP, and so can a whole client. Either counts — a VIP ticket sorts above others at the same priority.",
      },
      { h: "Working a queue" },
      {
        list: [
          "Click Edit on a row to change status, priority and assignees without leaving the list. One save per row.",
          "Tick several rows to move them between boards, or onto a project. A ticket can only join a project belonging to its own client; the others are skipped and named.",
          "Client and assignee pickers filter as you type, on any part of the name — “penner” finds “EG Penner Building Centres”.",
        ],
      },
      { h: "Assignees" },
      {
        p: "A ticket can have several assignees. The first is the primary: notifications address them, reporting attributes the work to them, and the “unassigned” count is measured against them. Adding somebody is additive — it never removes whoever was already on the ticket. To take someone off, remove their chip explicitly.",
      },
      {
        note: "My Tickets shows every ticket you are on, not only the ones where you are primary.",
      },
    ],
  },
  {
    id: "sla",
    title: "SLA",
    summary: "Response and resolution targets, measured in business hours.",
    blocks: [
      {
        p: "Targets are per priority, for first response and for resolution, and they are measured in business hours against the SLA's own calendar — weekends and holidays do not count. A ticket opened at 4pm on Friday with a four-hour target is not breached by Monday morning.",
      },
      {
        p: "Putting a ticket into a status that stops the clock (“waiting on client”) pauses it; a client reply resumes it. The paused minutes are stored, so a breach can always be explained.",
      },
      {
        p: "The first client-visible note or reply counts as the first response. An internal note does not.",
      },
    ],
  },
  {
    id: "time",
    title: "Time",
    summary: "Logging it, which agreement it lands on, and what it is worth.",
    blocks: [
      {
        p: "Time is logged against a ticket. Enter it as 1.5, 1:30, 90m or 1h30m — all four parse. Leaving the date blank means now, and the entry keeps the real timestamp so the time band (after-hours, weekend) is resolved from when the work actually happened.",
      },
      { h: "Which agreement it goes to" },
      {
        p: "If the ticket has no agreement, SilverFang picks one: the client's configured default first, then their managed services agreement, then managed NOC. Only active, in-term agreements are eligible. The agreement is written back onto the ticket so the ticket and the invoice cannot disagree.",
      },
      {
        note: "Block time is never chosen automatically. It is prepaid hours drawn down by every entry, and spending someone's balance because nothing else matched is an invoiceable mistake. Choose it deliberately.",
      },
      { h: "Rates" },
      {
        p: "The rate comes from the rate rules, narrowest match first, with the agreement's standard rate and the technician's own rate as fallbacks. When nothing resolves, the entry is saved with no rate and says so — an unrated billable hour is flagged rather than given an invented number.",
      },
      { h: "Timesheets and the calendar" },
      {
        p: "Entries attach to your weekly timesheet automatically. Scheduled time blocks appear on the week calendar and, if you have enabled it on your technician profile, sync to your Outlook calendar.",
      },
    ],
  },
  {
    id: "agreements",
    title: "Agreements",
    summary: "What the client bought, and who may bill against it.",
    blocks: [
      {
        list: [
          "Managed services — recurring all-in support, optionally with included hours and an overage rate.",
          "Managed NOC — recurring monitoring.",
          "Block time — prepaid hours, drawn down oldest-first by logged time.",
        ],
      },
      {
        p: "Block-time balances are computed from the drawdown ledger every time they are shown, so they always reconcile with the logged time rather than drifting from a stored counter.",
      },
      { h: "Renewals" },
      {
        p: "Ticking auto-renew is the consent. Once the term ends, the scheduled sweep applies the uplift (15% by default, editable per agreement) to the recurring fee — never to hourly rates — and rolls the term forward. A term renews once however many times the sweep runs, and every renewal is audited.",
      },
      { h: "Authorised technicians" },
      {
        p: "An agreement or project can name the technicians allowed to log time against it, which stops somebody drawing down the wrong client's prepaid block by accident. Anyone left off still sees it and can read every detail — the row is greyed and time is refused.",
      },
      {
        note: "An empty list means everyone. The restriction only exists once you name somebody. Editing the list is never itself restricted, so a record can never become permanently locked.",
      },
    ],
  },
  {
    id: "projects",
    title: "Projects and templates",
    summary: "Scoped work with phases, and reusable shapes to stamp them out.",
    blocks: [
      {
        p: "A project holds phases; phases hold tasks and tickets. Phase hours sum to the project's contracted total, and a mismatch is surfaced on the project rather than refused, because a project is reshaped a field at a time.",
      },
      {
        p: "Billing is time and materials or fixed fee. On a fixed fee, hours are tracked identically but never shown to the client. A deposit is a percentage of the total; once it has been invoiced the amount is frozen, so a later change to the total cannot rewrite an invoice that already went out.",
      },
      { h: "Templates" },
      {
        p: "A template is a reusable project shape — phases with hours, tasks as day-offsets from the start, and ticket stubs — with no client attached. Build one from scratch, or open a project you have already run and use Save as template.",
      },
      {
        p: "Capturing a project deliberately leaves behind the client, agreement, manager, dates and logged hours, and does not copy ticket or task descriptions: a ticket body is one client's problem in their words, and it would follow the template onto every project made from it.",
      },
      {
        p: "Generating a project from a template creates its phases, its tasks with due dates worked out from the start date plus each offset, and its tickets on the Projects board.",
      },
    ],
  },
  {
    id: "email",
    title: "Email",
    summary: "How mail becomes a ticket, and the two gates on sending.",
    blocks: [
      { h: "Inbound" },
      {
        p: "A message is matched to a ticket by our own header first, then the [SF-1042] tag in the subject, then In-Reply-To/References. No match opens a new ticket. Nothing is dropped silently: every message gets a row in Inbound mail activity saying which decision applied.",
      },
      {
        p: "The sender is resolved to a client by their contact record, else by another contact on the same business domain, else the mailbox's fallback client. A domain match also creates the contact, so their next message matches by address. Consumer domains are never domain-matched — sharing gmail.com says nothing about who someone works for.",
      },
      {
        p: "Senders nobody has on file appear under Unrecognised senders with a client suggested for each and a one-click way to file them. Adding the contact fixes the next message; the ones already refused are not retried.",
      },
      {
        p: "Auto-submitted mail — out-of-office, bounces — never opens a ticket and never triggers an auto-response, or two robots mail each other forever.",
      },
      { h: "Outbound: two gates" },
      {
        list: [
          "The master switch. Off means nothing is sent, at all.",
          "Allow email to client, per client. Off is the permanent default.",
        ],
      },
      {
        note: "Both must be on for a client to receive anything. This is deliberate: a service desk that starts mailing clients as a side effect of being configured is worse than one that sends nothing until somebody says so.",
      },
      {
        p: "Auto-response rules are seeded switched off for the same reason. Turn on the ones you want on the Email page.",
      },
    ],
  },
  {
    id: "reporting",
    title: "Service reporting",
    summary: "Utilisation, realisation, margin — in that order.",
    blocks: [
      {
        p: "Three questions, in the order that matters: are the technicians busy (utilisation), did we get paid for it (realisation), and was it worth doing (margin).",
      },
      {
        p: "Utilisation without realisation flatters you — a technician can be fully utilised on hours that were all absorbed by an agreement. The hours worth chasing are billable hours with no rate at all: those are hours nobody priced, which is different from hours somebody decided to give away.",
      },
    ],
  },
  {
    id: "migration",
    title: "Migrating from SuperOps",
    summary: "Bring the history across, then switch SuperOps off.",
    blocks: [
      {
        p: "Everything moves in two stages, and always in that order: the connector **mirrors** SuperOps into read-only tables, then an **import** turns those rows into SilverFang records. The mirror is a faithful copy, so a mapping can be corrected and re-imported later without going back to an API that may by then be cancelled.",
      },
      { h: "The order to do it in" },
      {
        list: [
          "Clients and contacts, from the Clients page. Nothing else can import until a SuperOps client is linked to a Wolf365 client.",
          "Tickets, from Tickets → Import from SuperOps. Asks whether to overwrite ones it imported before.",
          "Worklogs, on the same page. They become time entries, as drafts.",
          "Conversations, from SuperOps Migration. Mirror first, then import them onto the tickets.",
        ],
      },
      {
        p: "Every step is keyed on the source record's id, so all of them are safe to re-run: a second pass finds the same record instead of duplicating it. Run them as often as you like while both systems are live.",
      },
      { h: "Knowing when you are done" },
      {
        p: "The SuperOps Migration page compares what has been mirrored against what has been imported, line by line. What it cannot tell you is whether the mirror itself is complete — check that the ticket sync reports \u201cBackfill complete\u201d on Connector Data before trusting the totals.",
      },
      { h: "The cutover" },
      {
        p: "One switch, for the whole install. Turning SuperOps off stops the scheduled sync, the manual syncs and every import path, and SilverFang becomes the source of truth. The SuperOps Migration page is Administrator-only — a SilverFang administrator runs the service desk, but turning a connector off for the whole company is not part of running the service desk.",
      },
      {
        note: "Switching off deletes nothing. The tickets, time, notes and contacts already imported are SilverFang's own records — that is the point of having migrated them. The switch is reversible if you need one more pass before the subscription ends.",
      },
    ],
  },
  {
    id: "roles",
    title: "Roles and access",
    summary: "Who can do what, and the two independent gates.",
    blocks: [
      {
        p: "Two separate checks apply to every request. The workspace gate asks whether your role belongs on this route at all — each product is its own territory, and only administrators and power users cross between them. The permission gate asks whether you may do this kind of thing, and is checked per page and per action.",
      },
      {
        list: [
          "SilverFang User — works tickets and logs time. No configuration, no approvals.",
          "SilverFang Admin — full control of SilverFang including its setup, mailboxes and rate rules.",
        ],
      },
      {
        p: "Administrators can preview the app as any role with View as, which is audited at both ends.",
      },
    ],
  },
  {
    id: "setup",
    title: "Getting set up",
    summary: "The order to do things in on a fresh install.",
    blocks: [
      {
        list: [
          "Run SilverFang Setup. It creates the three boards with their statuses, the default SLA with business hours, the standard charge codes, and the auto-response templates (switched off).",
          "Import clients and contacts from SuperOps on the Clients page. Safe to re-run: contacts key off their source id, so a second run updates rather than duplicating.",
          "Tag your managed customers from Agreements, which creates a draft managed agreement for each. Drafts cannot bill — fill in the amounts and set them Active.",
          "Import tickets from SuperOps, from the Tickets page, if you are moving an existing service desk across. It asks whether to overwrite tickets it has imported before; No is the safe answer and creates only what is missing. Import the worklogs as a second step — they become time entries, as drafts.",
          "Add a mailbox on the Email page if you want tickets to arrive by email, and set its fallback client and start-from date.",
          "Set rate rules so logged time resolves to a price.",
          "Turn on the auto-response rules you want, then the master email switch, then Allow email to client for the clients who should hear from you.",
        ],
      },
      {
        note: "Every step above is idempotent. Running setup again never disturbs an existing board, status, or the tickets on it.",
      },
    ],
  },
];

/** Ids for anchor links and the contents list. */
export function docSectionIds(): string[] {
  return DOC_SECTIONS.map((s) => s.id);
}
