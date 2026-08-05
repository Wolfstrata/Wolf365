-- SilverFang — first-party ticketing / PSA module (ConnectWise-style).
-- Roles, enums, and the full data model: boards/statuses/tickets (+notes,
-- messages, history), contacts, charge codes, rate rules, time entries,
-- timesheets, agreements (+block-time ledger), SLAs (+business hours, holidays,
-- events), projects (+tasks, templates), auto-responses, tech profiles, and
-- calendar links. Idempotent.

-- Roles.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SILVERFANG_ADMIN';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SILVERFANG_USER';

-- Audit actions.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TICKET_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TICKET_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TICKET_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TICKET_CLOSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TICKET_NOTE_ADDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TIME_LOGGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TIME_ENTRY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TIMESHEET_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TIMESHEET_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AGREEMENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AGREEMENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROJECT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROJECT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SILVERFANG_CONFIG_CHANGED';

-- SilverFang enums.
DO $$ BEGIN CREATE TYPE "SfTicketPriority" AS ENUM ('P1','P2','P3','P4'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SfTicketSource" AS ENUM ('PORTAL','EMAIL','PHONE','ALERT','PROJECT','RECURRING'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SfAgreementType" AS ENUM ('BLOCK_TIME','MANAGED_SERVICES','MANAGED_NOC','PROJECT','TIME_AND_MATERIALS'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SfAgreementStatus" AS ENUM ('DRAFT','ACTIVE','EXPIRED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SfTimeEntryStatus" AS ENUM ('DRAFT','SUBMITTED','APPROVED','REJECTED','INVOICED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SfTimesheetStatus" AS ENUM ('OPEN','SUBMITTED','APPROVED','REJECTED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SfProjectStatus" AS ENUM ('PLANNED','ACTIVE','ON_HOLD','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SfTaskStatus" AS ENUM ('NOT_STARTED','IN_PROGRESS','BLOCKED','COMPLETED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SfRateScope" AS ENUM ('AGREEMENT_SERVICE','AGREEMENT','CLIENT_SERVICE','CLIENT','SERVICE','GLOBAL'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SfTimeBand" AS ENUM ('ANY','DAY','AFTER_HOURS','WEEKEND','HOLIDAY'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SfSlaTargetKind" AS ENUM ('RESPONSE','RESOLUTION'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SfChargeCodeKind" AS ENUM ('BILLABLE_WORK','NON_BILLABLE_WORK','ADMIN','TIME_OFF'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Tables.
CREATE TABLE IF NOT EXISTS "SfSla" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "useBusinessHours" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfSla_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfSlaTarget" (
    "id" TEXT NOT NULL,
    "slaId" TEXT NOT NULL,
    "priority" "SfTicketPriority" NOT NULL,
    "kind" "SfSlaTargetKind" NOT NULL,
    "minutes" INTEGER NOT NULL,
    CONSTRAINT "SfSlaTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfBusinessHours" (
    "id" TEXT NOT NULL,
    "slaId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Winnipeg',
    CONSTRAINT "SfBusinessHours_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfHoliday" (
    "id" TEXT NOT NULL,
    "slaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfHoliday_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfBoard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "slaId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfBoard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfStatus" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "stopsSlaClock" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfStatus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfContact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "title" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfChargeCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SfChargeCodeKind" NOT NULL DEFAULT 'BILLABLE_WORK',
    "billableDefault" BOOLEAN NOT NULL DEFAULT true,
    "defaultMultiplier" DECIMAL(6,3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfChargeCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfAgreement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SfAgreementType" NOT NULL,
    "status" "SfAgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "billingFrequency" TEXT,
    "monthlyAmount" DECIMAL(18,2),
    "includedHours" DECIMAL(18,4),
    "overageRate" DECIMAL(18,4),
    "standardRate" DECIMAL(18,4),
    "notes" TEXT,
    "createdById" TEXT,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfAgreement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfAgreementBlock" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "purchasedHours" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4),
    "amount" DECIMAL(18,2),
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "poNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfAgreementBlock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfProjectTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfProjectTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfProjectTemplateTask" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "phase" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "estimatedHours" DECIMAL(18,4),
    "dueOffsetDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfProjectTemplateTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfProject" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agreementId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SfProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "managerId" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "estimatedHours" DECIMAL(18,4),
    "budgetAmount" DECIMAL(18,2),
    "templateId" TEXT,
    "createdById" TEXT,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfProjectTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phase" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "SfTaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "assigneeId" TEXT,
    "estimatedHours" DECIMAL(18,4),
    "actualHours" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfProjectTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfTicket" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT,
    "boardId" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,
    "priority" "SfTicketPriority" NOT NULL DEFAULT 'P3',
    "source" "SfTicketSource" NOT NULL DEFAULT 'PORTAL',
    "type" TEXT,
    "subtype" TEXT,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "agreementId" TEXT,
    "projectId" TEXT,
    "projectTaskId" TEXT,
    "estimatedHours" DECIMAL(18,4),
    "actualHours" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "slaId" TEXT,
    "responseDueAt" TIMESTAMP(3),
    "resolutionDueAt" TIMESTAMP(3),
    "firstRespondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "slaResponseBreached" BOOLEAN NOT NULL DEFAULT false,
    "slaResolutionBreached" BOOLEAN NOT NULL DEFAULT false,
    "slaPausedMinutes" INTEGER NOT NULL DEFAULT 0,
    "slaPausedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfTicketNote" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internalOnly" BOOLEAN NOT NULL DEFAULT true,
    "emailedAt" TIMESTAMP(3),
    "authorId" TEXT,
    "authorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfTicketNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfTicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ccAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "messageId" TEXT,
    "inReplyTo" TEXT,
    "references" TEXT,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "externalId" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SfTicketMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfTicketHistory" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedById" TEXT,
    "changedByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SfTicketHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfRateRule" (
    "id" TEXT NOT NULL,
    "scope" "SfRateScope" NOT NULL,
    "clientId" TEXT,
    "agreementId" TEXT,
    "chargeCodeId" TEXT,
    "timeBand" "SfTimeBand" NOT NULL DEFAULT 'ANY',
    "fixedRate" DECIMAL(18,4),
    "multiplier" DECIMAL(6,3),
    "costRate" DECIMAL(18,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfRateRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfTimesheet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "status" "SfTimesheetStatus" NOT NULL DEFAULT 'OPEN',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedByEmail" TEXT,
    "rejectionNote" TEXT,
    "totalHours" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "billableHours" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfTimesheet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfTimeEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticketId" TEXT,
    "projectTaskId" TEXT,
    "agreementId" TEXT,
    "chargeCodeId" TEXT NOT NULL,
    "timesheetId" TEXT,
    "workDate" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "hours" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "internalOnly" BOOLEAN NOT NULL DEFAULT false,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "timeBand" "SfTimeBand" NOT NULL DEFAULT 'ANY',
    "rate" DECIMAL(18,4),
    "costRate" DECIMAL(18,4),
    "amount" DECIMAL(18,4),
    "status" "SfTimeEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "invoicedAt" TIMESTAMP(3),
    "qboInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfTimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfAgreementBlockDraw" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "timeEntryId" TEXT,
    "hours" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SfAgreementBlockDraw_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfSlaEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetKind" "SfSlaTargetKind",
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SfSlaEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfAutoResponseRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "boardId" TEXT,
    "statusId" TEXT,
    "priority" "SfTicketPriority",
    "audience" TEXT NOT NULL DEFAULT 'CONTACT',
    "subjectTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfAutoResponseRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfTechProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT,
    "defaultChargeCodeId" TEXT,
    "billRate" DECIMAL(18,4),
    "costRate" DECIMAL(18,4),
    "calendarMailbox" TEXT,
    "calendarSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfTechProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfCalendarLink" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "mailbox" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "iCalUid" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfCalendarLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SfCounter" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SfCounter_pkey" PRIMARY KEY ("name")
);

-- Unique constraints.
CREATE UNIQUE INDEX IF NOT EXISTS "SfSla_name_key" ON "SfSla"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "SfSlaTarget_slaId_priority_kind_key" ON "SfSlaTarget"("slaId","priority","kind");
CREATE UNIQUE INDEX IF NOT EXISTS "SfBusinessHours_slaId_weekday_key" ON "SfBusinessHours"("slaId","weekday");
CREATE UNIQUE INDEX IF NOT EXISTS "SfHoliday_slaId_date_key" ON "SfHoliday"("slaId","date");
CREATE UNIQUE INDEX IF NOT EXISTS "SfBoard_name_key" ON "SfBoard"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "SfStatus_boardId_name_key" ON "SfStatus"("boardId","name");
CREATE UNIQUE INDEX IF NOT EXISTS "SfChargeCode_code_key" ON "SfChargeCode"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "SfTicket_number_key" ON "SfTicket"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "SfTicketMessage_messageId_key" ON "SfTicketMessage"("messageId");
CREATE UNIQUE INDEX IF NOT EXISTS "SfTimesheet_userId_weekStart_key" ON "SfTimesheet"("userId","weekStart");
CREATE UNIQUE INDEX IF NOT EXISTS "SfProjectTemplate_name_key" ON "SfProjectTemplate"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "SfAutoResponseRule_name_key" ON "SfAutoResponseRule"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "SfTechProfile_userId_key" ON "SfTechProfile"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "SfCalendarLink_mailbox_eventId_key" ON "SfCalendarLink"("mailbox","eventId");

-- Lookup indexes.
CREATE INDEX IF NOT EXISTS "SfSla_active_idx" ON "SfSla"("active");
CREATE INDEX IF NOT EXISTS "SfSlaTarget_slaId_idx" ON "SfSlaTarget"("slaId");
CREATE INDEX IF NOT EXISTS "SfBusinessHours_slaId_idx" ON "SfBusinessHours"("slaId");
CREATE INDEX IF NOT EXISTS "SfHoliday_slaId_date_idx" ON "SfHoliday"("slaId","date");
CREATE INDEX IF NOT EXISTS "SfBoard_slaId_idx" ON "SfBoard"("slaId");
CREATE INDEX IF NOT EXISTS "SfStatus_boardId_sortOrder_idx" ON "SfStatus"("boardId","sortOrder");
CREATE INDEX IF NOT EXISTS "SfContact_clientId_idx" ON "SfContact"("clientId");
CREATE INDEX IF NOT EXISTS "SfContact_email_idx" ON "SfContact"("email");
CREATE INDEX IF NOT EXISTS "SfChargeCode_active_sortOrder_idx" ON "SfChargeCode"("active","sortOrder");
CREATE INDEX IF NOT EXISTS "SfAgreement_clientId_status_idx" ON "SfAgreement"("clientId","status");
CREATE INDEX IF NOT EXISTS "SfAgreement_type_status_idx" ON "SfAgreement"("type","status");
CREATE INDEX IF NOT EXISTS "SfAgreementBlock_agreementId_purchasedAt_idx" ON "SfAgreementBlock"("agreementId","purchasedAt");
CREATE INDEX IF NOT EXISTS "SfProjectTemplate_active_idx" ON "SfProjectTemplate"("active");
CREATE INDEX IF NOT EXISTS "SfProjectTemplateTask_templateId_sortOrder_idx" ON "SfProjectTemplateTask"("templateId","sortOrder");
CREATE INDEX IF NOT EXISTS "SfProject_clientId_status_idx" ON "SfProject"("clientId","status");
CREATE INDEX IF NOT EXISTS "SfProject_managerId_idx" ON "SfProject"("managerId");
CREATE INDEX IF NOT EXISTS "SfProject_status_dueDate_idx" ON "SfProject"("status","dueDate");
CREATE INDEX IF NOT EXISTS "SfProjectTask_projectId_sortOrder_idx" ON "SfProjectTask"("projectId","sortOrder");
CREATE INDEX IF NOT EXISTS "SfProjectTask_assigneeId_idx" ON "SfProjectTask"("assigneeId");
CREATE INDEX IF NOT EXISTS "SfProjectTask_status_idx" ON "SfProjectTask"("status");
CREATE INDEX IF NOT EXISTS "SfTicket_clientId_idx" ON "SfTicket"("clientId");
CREATE INDEX IF NOT EXISTS "SfTicket_boardId_statusId_idx" ON "SfTicket"("boardId","statusId");
CREATE INDEX IF NOT EXISTS "SfTicket_assigneeId_idx" ON "SfTicket"("assigneeId");
CREATE INDEX IF NOT EXISTS "SfTicket_statusId_createdAt_idx" ON "SfTicket"("statusId","createdAt");
CREATE INDEX IF NOT EXISTS "SfTicket_priority_openedAt_idx" ON "SfTicket"("priority","openedAt");
CREATE INDEX IF NOT EXISTS "SfTicket_agreementId_idx" ON "SfTicket"("agreementId");
CREATE INDEX IF NOT EXISTS "SfTicket_projectId_idx" ON "SfTicket"("projectId");
CREATE INDEX IF NOT EXISTS "SfTicketNote_ticketId_createdAt_idx" ON "SfTicketNote"("ticketId","createdAt");
CREATE INDEX IF NOT EXISTS "SfTicketMessage_ticketId_createdAt_idx" ON "SfTicketMessage"("ticketId","createdAt");
CREATE INDEX IF NOT EXISTS "SfTicketMessage_externalId_idx" ON "SfTicketMessage"("externalId");
CREATE INDEX IF NOT EXISTS "SfTicketHistory_ticketId_createdAt_idx" ON "SfTicketHistory"("ticketId","createdAt");
CREATE INDEX IF NOT EXISTS "SfRateRule_scope_active_idx" ON "SfRateRule"("scope","active");
CREATE INDEX IF NOT EXISTS "SfRateRule_clientId_idx" ON "SfRateRule"("clientId");
CREATE INDEX IF NOT EXISTS "SfRateRule_agreementId_idx" ON "SfRateRule"("agreementId");
CREATE INDEX IF NOT EXISTS "SfRateRule_chargeCodeId_idx" ON "SfRateRule"("chargeCodeId");
CREATE INDEX IF NOT EXISTS "SfTimesheet_status_weekStart_idx" ON "SfTimesheet"("status","weekStart");
CREATE INDEX IF NOT EXISTS "SfTimeEntry_userId_workDate_idx" ON "SfTimeEntry"("userId","workDate");
CREATE INDEX IF NOT EXISTS "SfTimeEntry_ticketId_idx" ON "SfTimeEntry"("ticketId");
CREATE INDEX IF NOT EXISTS "SfTimeEntry_status_workDate_idx" ON "SfTimeEntry"("status","workDate");
CREATE INDEX IF NOT EXISTS "SfTimeEntry_agreementId_idx" ON "SfTimeEntry"("agreementId");
CREATE INDEX IF NOT EXISTS "SfTimeEntry_timesheetId_idx" ON "SfTimeEntry"("timesheetId");
CREATE INDEX IF NOT EXISTS "SfAgreementBlockDraw_blockId_createdAt_idx" ON "SfAgreementBlockDraw"("blockId","createdAt");
CREATE INDEX IF NOT EXISTS "SfAgreementBlockDraw_timeEntryId_idx" ON "SfAgreementBlockDraw"("timeEntryId");
CREATE INDEX IF NOT EXISTS "SfSlaEvent_ticketId_occurredAt_idx" ON "SfSlaEvent"("ticketId","occurredAt");
CREATE INDEX IF NOT EXISTS "SfAutoResponseRule_active_trigger_idx" ON "SfAutoResponseRule"("active","trigger");
CREATE INDEX IF NOT EXISTS "SfTechProfile_defaultChargeCodeId_idx" ON "SfTechProfile"("defaultChargeCodeId");
CREATE INDEX IF NOT EXISTS "SfCalendarLink_ticketId_idx" ON "SfCalendarLink"("ticketId");

-- Foreign keys (guarded so re-apply is safe).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfSlaTarget_slaId_fkey') THEN
    ALTER TABLE "SfSlaTarget" ADD CONSTRAINT "SfSlaTarget_slaId_fkey" FOREIGN KEY ("slaId") REFERENCES "SfSla"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfBusinessHours_slaId_fkey') THEN
    ALTER TABLE "SfBusinessHours" ADD CONSTRAINT "SfBusinessHours_slaId_fkey" FOREIGN KEY ("slaId") REFERENCES "SfSla"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfHoliday_slaId_fkey') THEN
    ALTER TABLE "SfHoliday" ADD CONSTRAINT "SfHoliday_slaId_fkey" FOREIGN KEY ("slaId") REFERENCES "SfSla"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfBoard_slaId_fkey') THEN
    ALTER TABLE "SfBoard" ADD CONSTRAINT "SfBoard_slaId_fkey" FOREIGN KEY ("slaId") REFERENCES "SfSla"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfStatus_boardId_fkey') THEN
    ALTER TABLE "SfStatus" ADD CONSTRAINT "SfStatus_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "SfBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfContact_clientId_fkey') THEN
    ALTER TABLE "SfContact" ADD CONSTRAINT "SfContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfAgreement_clientId_fkey') THEN
    ALTER TABLE "SfAgreement" ADD CONSTRAINT "SfAgreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfAgreementBlock_agreementId_fkey') THEN
    ALTER TABLE "SfAgreementBlock" ADD CONSTRAINT "SfAgreementBlock_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "SfAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfProjectTemplateTask_templateId_fkey') THEN
    ALTER TABLE "SfProjectTemplateTask" ADD CONSTRAINT "SfProjectTemplateTask_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SfProjectTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfProject_clientId_fkey') THEN
    ALTER TABLE "SfProject" ADD CONSTRAINT "SfProject_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfProject_agreementId_fkey') THEN
    ALTER TABLE "SfProject" ADD CONSTRAINT "SfProject_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "SfAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfProject_managerId_fkey') THEN
    ALTER TABLE "SfProject" ADD CONSTRAINT "SfProject_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfProject_templateId_fkey') THEN
    ALTER TABLE "SfProject" ADD CONSTRAINT "SfProject_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SfProjectTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfProjectTask_projectId_fkey') THEN
    ALTER TABLE "SfProjectTask" ADD CONSTRAINT "SfProjectTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SfProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfProjectTask_assigneeId_fkey') THEN
    ALTER TABLE "SfProjectTask" ADD CONSTRAINT "SfProjectTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicket_clientId_fkey') THEN
    ALTER TABLE "SfTicket" ADD CONSTRAINT "SfTicket_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicket_contactId_fkey') THEN
    ALTER TABLE "SfTicket" ADD CONSTRAINT "SfTicket_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "SfContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicket_boardId_fkey') THEN
    ALTER TABLE "SfTicket" ADD CONSTRAINT "SfTicket_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "SfBoard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicket_statusId_fkey') THEN
    ALTER TABLE "SfTicket" ADD CONSTRAINT "SfTicket_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "SfStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicket_assigneeId_fkey') THEN
    ALTER TABLE "SfTicket" ADD CONSTRAINT "SfTicket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicket_agreementId_fkey') THEN
    ALTER TABLE "SfTicket" ADD CONSTRAINT "SfTicket_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "SfAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicket_projectId_fkey') THEN
    ALTER TABLE "SfTicket" ADD CONSTRAINT "SfTicket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SfProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicket_projectTaskId_fkey') THEN
    ALTER TABLE "SfTicket" ADD CONSTRAINT "SfTicket_projectTaskId_fkey" FOREIGN KEY ("projectTaskId") REFERENCES "SfProjectTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicket_slaId_fkey') THEN
    ALTER TABLE "SfTicket" ADD CONSTRAINT "SfTicket_slaId_fkey" FOREIGN KEY ("slaId") REFERENCES "SfSla"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicket_createdById_fkey') THEN
    ALTER TABLE "SfTicket" ADD CONSTRAINT "SfTicket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicketNote_ticketId_fkey') THEN
    ALTER TABLE "SfTicketNote" ADD CONSTRAINT "SfTicketNote_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SfTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicketMessage_ticketId_fkey') THEN
    ALTER TABLE "SfTicketMessage" ADD CONSTRAINT "SfTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SfTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicketHistory_ticketId_fkey') THEN
    ALTER TABLE "SfTicketHistory" ADD CONSTRAINT "SfTicketHistory_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SfTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfRateRule_agreementId_fkey') THEN
    ALTER TABLE "SfRateRule" ADD CONSTRAINT "SfRateRule_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "SfAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfRateRule_chargeCodeId_fkey') THEN
    ALTER TABLE "SfRateRule" ADD CONSTRAINT "SfRateRule_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "SfChargeCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTimesheet_userId_fkey') THEN
    ALTER TABLE "SfTimesheet" ADD CONSTRAINT "SfTimesheet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTimeEntry_userId_fkey') THEN
    ALTER TABLE "SfTimeEntry" ADD CONSTRAINT "SfTimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTimeEntry_ticketId_fkey') THEN
    ALTER TABLE "SfTimeEntry" ADD CONSTRAINT "SfTimeEntry_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SfTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTimeEntry_projectTaskId_fkey') THEN
    ALTER TABLE "SfTimeEntry" ADD CONSTRAINT "SfTimeEntry_projectTaskId_fkey" FOREIGN KEY ("projectTaskId") REFERENCES "SfProjectTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTimeEntry_agreementId_fkey') THEN
    ALTER TABLE "SfTimeEntry" ADD CONSTRAINT "SfTimeEntry_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "SfAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTimeEntry_chargeCodeId_fkey') THEN
    ALTER TABLE "SfTimeEntry" ADD CONSTRAINT "SfTimeEntry_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "SfChargeCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTimeEntry_timesheetId_fkey') THEN
    ALTER TABLE "SfTimeEntry" ADD CONSTRAINT "SfTimeEntry_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "SfTimesheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfAgreementBlockDraw_blockId_fkey') THEN
    ALTER TABLE "SfAgreementBlockDraw" ADD CONSTRAINT "SfAgreementBlockDraw_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "SfAgreementBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfAgreementBlockDraw_timeEntryId_fkey') THEN
    ALTER TABLE "SfAgreementBlockDraw" ADD CONSTRAINT "SfAgreementBlockDraw_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "SfTimeEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfSlaEvent_ticketId_fkey') THEN
    ALTER TABLE "SfSlaEvent" ADD CONSTRAINT "SfSlaEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SfTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTechProfile_userId_fkey') THEN
    ALTER TABLE "SfTechProfile" ADD CONSTRAINT "SfTechProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTechProfile_defaultChargeCodeId_fkey') THEN
    ALTER TABLE "SfTechProfile" ADD CONSTRAINT "SfTechProfile_defaultChargeCodeId_fkey" FOREIGN KEY ("defaultChargeCodeId") REFERENCES "SfChargeCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfCalendarLink_ticketId_fkey') THEN
    ALTER TABLE "SfCalendarLink" ADD CONSTRAINT "SfCalendarLink_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SfTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
