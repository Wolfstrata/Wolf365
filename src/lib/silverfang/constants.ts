/**
 * SilverFang display labels and seed defaults.
 *
 * Label maps keep enum rendering consistent across pages; the seed defaults give
 * a brand-new install a usable ConnectWise-like service desk immediately.
 */
import type {
  SfAgreementStatus,
  SfAgreementType,
  SfChargeCodeKind,
  SfProjectStatus,
  SfTaskStatus,
  SfTicketPriority,
  SfTicketSource,
  SfTimeBand,
  SfTimeEntryStatus,
  SfTimesheetStatus,
} from "@prisma/client";

export const PRIORITY_LABELS: Record<SfTicketPriority, string> = {
  P1: "P1 — Critical",
  P2: "P2 — High",
  P3: "P3 — Normal",
  P4: "P4 — Low",
};

/** Badge classes per priority, using the app's semantic tokens. */
export const PRIORITY_STYLES: Record<SfTicketPriority, string> = {
  P1: "bg-danger/15 text-danger",
  P2: "bg-warning/15 text-warning",
  P3: "bg-accent text-accent-foreground",
  P4: "bg-muted text-muted-foreground",
};

export const SOURCE_LABELS: Record<SfTicketSource, string> = {
  PORTAL: "Portal",
  EMAIL: "Email",
  PHONE: "Phone",
  ALERT: "Alert",
  PROJECT: "Project",
  RECURRING: "Recurring",
};

export const AGREEMENT_TYPE_LABELS: Record<SfAgreementType, string> = {
  BLOCK_TIME: "Block time",
  MANAGED_SERVICES: "Managed services",
  MANAGED_NOC: "Managed NOC",
  PROJECT: "Project",
  TIME_AND_MATERIALS: "Time & materials",
};

export const AGREEMENT_STATUS_LABELS: Record<SfAgreementStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

export const TIME_ENTRY_STATUS_LABELS: Record<SfTimeEntryStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  INVOICED: "Invoiced",
};

export const TIMESHEET_STATUS_LABELS: Record<SfTimesheetStatus, string> = {
  OPEN: "Open",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const PROJECT_STATUS_LABELS: Record<SfProjectStatus, string> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const TASK_STATUS_LABELS: Record<SfTaskStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
};

export const TIME_BAND_LABELS: Record<SfTimeBand, string> = {
  ANY: "Any time",
  DAY: "Business hours",
  AFTER_HOURS: "After hours",
  WEEKEND: "Weekend",
  HOLIDAY: "Holiday",
};

export const CHARGE_CODE_KIND_LABELS: Record<SfChargeCodeKind, string> = {
  BILLABLE_WORK: "Billable work",
  NON_BILLABLE_WORK: "Non-billable work",
  ADMIN: "Admin",
  TIME_OFF: "Time off",
};

/** Default service-desk statuses for a fresh install (ConnectWise-like flow). */
export const DEFAULT_STATUSES: {
  name: string;
  sortOrder: number;
  isDefault?: boolean;
  isOpen: boolean;
  isClosed?: boolean;
  stopsSlaClock?: boolean;
}[] = [
  { name: "New", sortOrder: 10, isDefault: true, isOpen: true },
  { name: "Assigned", sortOrder: 20, isOpen: true },
  { name: "In Progress", sortOrder: 30, isOpen: true },
  { name: "Waiting on Client", sortOrder: 40, isOpen: true, stopsSlaClock: true },
  { name: "Waiting on Vendor", sortOrder: 50, isOpen: true, stopsSlaClock: true },
  { name: "Escalated", sortOrder: 60, isOpen: true },
  { name: "Resolved", sortOrder: 70, isOpen: false, isClosed: true },
  { name: "Closed", sortOrder: 80, isOpen: false, isClosed: true },
];

/** Default charge codes, covering the requested set. */
export const DEFAULT_CHARGE_CODES: {
  code: string;
  name: string;
  kind: SfChargeCodeKind;
  billableDefault: boolean;
  defaultMultiplier?: number;
  sortOrder: number;
}[] = [
  { code: "REMOTE", name: "Remote work", kind: "BILLABLE_WORK", billableDefault: true, sortOrder: 10 },
  { code: "ONSITE", name: "Onsite", kind: "BILLABLE_WORK", billableDefault: true, sortOrder: 20 },
  {
    code: "AFTERHOURS",
    name: "After hours",
    kind: "BILLABLE_WORK",
    billableDefault: true,
    defaultMultiplier: 1.5,
    sortOrder: 30,
  },
  { code: "PROJECT", name: "Project work", kind: "BILLABLE_WORK", billableDefault: true, sortOrder: 40 },
  { code: "PRESALES", name: "Pre-sales", kind: "NON_BILLABLE_WORK", billableDefault: false, sortOrder: 50 },
  { code: "ADMIN", name: "Admin", kind: "ADMIN", billableDefault: false, sortOrder: 60 },
  { code: "VACATION", name: "Vacation", kind: "TIME_OFF", billableDefault: false, sortOrder: 70 },
];

/** Default SLA targets in business minutes, per priority. */
export const DEFAULT_SLA_TARGETS: {
  priority: SfTicketPriority;
  response: number;
  resolution: number;
}[] = [
  { priority: "P1", response: 30, resolution: 240 },
  { priority: "P2", response: 60, resolution: 480 },
  { priority: "P3", response: 240, resolution: 1440 },
  { priority: "P4", response: 480, resolution: 2880 },
];

/** Default business hours: Mon–Fri 08:00–17:00. */
export const DEFAULT_BUSINESS_HOURS = {
  weekdays: [1, 2, 3, 4, 5],
  startMinute: 480,
  endMinute: 1020,
  timezone: "America/Winnipeg",
};

export const DEFAULT_BOARD_NAME = "Service Desk";
export const DEFAULT_SLA_NAME = "Standard SLA";

/**
 * Starter auto-response templates. Seeded **inactive**: mail to a client should
 * only start flowing when an admin deliberately switches a rule on, never as a
 * side effect of running setup.
 */
export const DEFAULT_AUTO_RESPONSES: {
  name: string;
  trigger: "TICKET_CREATED" | "STATUS_CHANGED" | "NOTE_ADDED" | "SLA_BREACHED";
  audience: "CONTACT" | "ASSIGNEE" | "BOTH";
  subjectTemplate: string;
  bodyTemplate: string;
}[] = [
  {
    name: "Ticket received acknowledgement",
    trigger: "TICKET_CREATED",
    audience: "CONTACT",
    subjectTemplate: "{{ticket.summary}}",
    bodyTemplate: [
      "Hello,",
      "",
      "Thanks for getting in touch — we have logged your request as ticket #{{ticket.number}} and a technician will review it shortly.",
      "",
      "Summary: {{ticket.summary}}",
      "Priority: {{ticket.priority}}",
      "",
      "You can reply to this email at any time and your reply will be added to the ticket.",
    ].join("\n"),
  },
  {
    name: "Assignment notice to technician",
    trigger: "TICKET_CREATED",
    audience: "ASSIGNEE",
    subjectTemplate: "New ticket: {{ticket.summary}}",
    bodyTemplate: [
      "A new ticket has been opened.",
      "",
      "Ticket: #{{ticket.number}} — {{ticket.summary}}",
      "Client: {{client.name}}",
      "Priority: {{ticket.priority}}",
      "Status: {{ticket.status}}",
      "",
      "{{ticket.url}}",
    ].join("\n"),
  },
  {
    name: "SLA breach alert to technician",
    trigger: "SLA_BREACHED",
    audience: "ASSIGNEE",
    subjectTemplate: "SLA breached: {{ticket.summary}}",
    bodyTemplate: [
      "An SLA target has been breached.",
      "",
      "Ticket: #{{ticket.number}} — {{ticket.summary}}",
      "Client: {{client.name}}",
      "Priority: {{ticket.priority}}",
      "",
      "{{ticket.url}}",
    ].join("\n"),
  },
];
