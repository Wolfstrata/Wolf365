-- SilverFang Billing: a pipeline of its own, parallel to the M365 billing runs.
--
-- Kept separate deliberately. The sources are unrelated (time, agreements and
-- projects rather than subscriptions), and one screen answering both questions
-- would serve neither. The review discipline is what is reused: DRAFT → REVIEWED
-- → APPROVED → PUSHED, with a field-level edit trail, and nothing reaching
-- QuickBooks until a human approves and pushes it.
DO $$
BEGIN
  CREATE TYPE "SfBillingRunStatus" AS ENUM
    ('DRAFT', 'REVIEWED', 'APPROVED', 'PUSHED', 'PARTIALLY_FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SfBillingLineKind" AS ENUM
    ('TIME', 'OVERAGE', 'RECURRING', 'BLOCK_PURCHASE', 'PROJECT_FEE', 'PROJECT_DEPOSIT', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Idempotency guards for the one-off charges: without these a second run would
-- either bill a prepaid block twice or never bill it at all.
ALTER TABLE "SfAgreementBlock"
  ADD COLUMN IF NOT EXISTS "invoicedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "qboInvoiceId" TEXT;

-- How far a fixed-fee project's schedule has been billed. Advanced only when a
-- fee line is actually pushed, so a failed push cannot skip a period.
ALTER TABLE "SfProject" ADD COLUMN IF NOT EXISTS "feeBilledThroughAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "SfBillingRun" (
    "id" TEXT NOT NULL,
    "status" "SfBillingRunStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdByEmail" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),
    "qboInvoiceId" TEXT,
    "pushError" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SfBillingRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SfBillingRun_status_createdAt_idx"
    ON "SfBillingRun"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "SfBillingRun_clientId_periodStart_idx"
    ON "SfBillingRun"("clientId", "periodStart");

CREATE TABLE IF NOT EXISTS "SfBillingLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" "SfBillingLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "adjustment" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(18,4) NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "estimatedCost" DECIMAL(18,4),
    "taxStatus" TEXT,
    "agreementId" TEXT,
    "projectId" TEXT,
    "blockId" TEXT,
    "chargeCodeId" TEXT,
    "hoursVisible" BOOLEAN NOT NULL DEFAULT true,
    "qboItemId" TEXT,
    "qboInvoiceId" TEXT,
    "pushError" TEXT,
    "notes" TEXT,

    CONSTRAINT "SfBillingLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SfBillingLine_runId_idx" ON "SfBillingLine"("runId");
CREATE INDEX IF NOT EXISTS "SfBillingLine_agreementId_idx" ON "SfBillingLine"("agreementId");
CREATE INDEX IF NOT EXISTS "SfBillingLine_projectId_idx" ON "SfBillingLine"("projectId");

-- Which time entries a line consumed. A join table, not a column on the entry:
-- one line rolls up many entries, and this mapping is what proves no hour was
-- billed twice or silently dropped.
CREATE TABLE IF NOT EXISTS "SfBillingLineTimeEntry" (
    "lineId" TEXT NOT NULL,
    "timeEntryId" TEXT NOT NULL,
    "hours" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "SfBillingLineTimeEntry_pkey" PRIMARY KEY ("lineId", "timeEntryId")
);
CREATE INDEX IF NOT EXISTS "SfBillingLineTimeEntry_timeEntryId_idx"
    ON "SfBillingLineTimeEntry"("timeEntryId");

CREATE TABLE IF NOT EXISTS "SfBillingLineEdit" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "lineId" TEXT,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "editedById" TEXT,
    "editedByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SfBillingLineEdit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SfBillingLineEdit_runId_createdAt_idx"
    ON "SfBillingLineEdit"("runId", "createdAt");

CREATE TABLE IF NOT EXISTS "SfChargeCodeItemMap" (
    "id" TEXT NOT NULL,
    "chargeCodeId" TEXT NOT NULL,
    "qboItemId" TEXT,
    "qboItemName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SfChargeCodeItemMap_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SfChargeCodeItemMap_chargeCodeId_key"
    ON "SfChargeCodeItemMap"("chargeCodeId");

CREATE TABLE IF NOT EXISTS "SfBillingKindItemMap" (
    "kind" "SfBillingLineKind" NOT NULL,
    "qboItemId" TEXT,
    "qboItemName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SfBillingKindItemMap_pkey" PRIMARY KEY ("kind")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfBillingRun_clientId_fkey') THEN
    ALTER TABLE "SfBillingRun" ADD CONSTRAINT "SfBillingRun_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfBillingLine_runId_fkey') THEN
    ALTER TABLE "SfBillingLine" ADD CONSTRAINT "SfBillingLine_runId_fkey"
      FOREIGN KEY ("runId") REFERENCES "SfBillingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfBillingLine_agreementId_fkey') THEN
    ALTER TABLE "SfBillingLine" ADD CONSTRAINT "SfBillingLine_agreementId_fkey"
      FOREIGN KEY ("agreementId") REFERENCES "SfAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfBillingLine_projectId_fkey') THEN
    ALTER TABLE "SfBillingLine" ADD CONSTRAINT "SfBillingLine_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "SfProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfBillingLine_blockId_fkey') THEN
    ALTER TABLE "SfBillingLine" ADD CONSTRAINT "SfBillingLine_blockId_fkey"
      FOREIGN KEY ("blockId") REFERENCES "SfAgreementBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfBillingLine_chargeCodeId_fkey') THEN
    ALTER TABLE "SfBillingLine" ADD CONSTRAINT "SfBillingLine_chargeCodeId_fkey"
      FOREIGN KEY ("chargeCodeId") REFERENCES "SfChargeCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfBillingLineTimeEntry_lineId_fkey') THEN
    ALTER TABLE "SfBillingLineTimeEntry" ADD CONSTRAINT "SfBillingLineTimeEntry_lineId_fkey"
      FOREIGN KEY ("lineId") REFERENCES "SfBillingLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfBillingLineTimeEntry_timeEntryId_fkey') THEN
    ALTER TABLE "SfBillingLineTimeEntry" ADD CONSTRAINT "SfBillingLineTimeEntry_timeEntryId_fkey"
      FOREIGN KEY ("timeEntryId") REFERENCES "SfTimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfBillingLineEdit_runId_fkey') THEN
    ALTER TABLE "SfBillingLineEdit" ADD CONSTRAINT "SfBillingLineEdit_runId_fkey"
      FOREIGN KEY ("runId") REFERENCES "SfBillingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfBillingLineEdit_lineId_fkey') THEN
    ALTER TABLE "SfBillingLineEdit" ADD CONSTRAINT "SfBillingLineEdit_lineId_fkey"
      FOREIGN KEY ("lineId") REFERENCES "SfBillingLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfChargeCodeItemMap_chargeCodeId_fkey') THEN
    ALTER TABLE "SfChargeCodeItemMap" ADD CONSTRAINT "SfChargeCodeItemMap_chargeCodeId_fkey"
      FOREIGN KEY ("chargeCodeId") REFERENCES "SfChargeCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
