-- Project phases, project billing type, and deposits.
--
-- Phases hold the hours sold for each stage; the project's contracted total is
-- the sum of them. Project tickets belong to a phase, so work is tracked against
-- the stage it belongs to rather than loose against the project.
--
-- FIXED_FEE tracks hours exactly as TIME_AND_MATERIALS does — the difference is
-- that its hours are internal and must never appear on anything client-facing.
-- Default is TIME_AND_MATERIALS so existing projects keep behaving as they did.
DO $$
BEGIN
  CREATE TYPE "SfProjectBillingType" AS ENUM ('TIME_AND_MATERIALS', 'FIXED_FEE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "SfProject"
  ADD COLUMN IF NOT EXISTS "billingType" "SfProjectBillingType" NOT NULL DEFAULT 'TIME_AND_MATERIALS',
  ADD COLUMN IF NOT EXISTS "fixedFeeAmount" DECIMAL(18,2),
  ADD COLUMN IF NOT EXISTS "billingIntervalDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "depositPercent" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "depositAmount" DECIMAL(18,2),
  ADD COLUMN IF NOT EXISTS "depositInvoicedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "SfProjectPhase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "hours" DECIMAL(18,4),
    "status" "SfTaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SfProjectPhase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SfProjectPhase_projectId_sortOrder_idx"
    ON "SfProjectPhase"("projectId", "sortOrder");

ALTER TABLE "SfProjectTask" ADD COLUMN IF NOT EXISTS "projectPhaseId" TEXT;
CREATE INDEX IF NOT EXISTS "SfProjectTask_projectPhaseId_idx"
    ON "SfProjectTask"("projectPhaseId");

ALTER TABLE "SfTicket" ADD COLUMN IF NOT EXISTS "projectPhaseId" TEXT;
CREATE INDEX IF NOT EXISTS "SfTicket_projectPhaseId_idx" ON "SfTicket"("projectPhaseId");

-- Time can be logged against a phase directly, without a task standing in for it.
ALTER TABLE "SfTimeEntry" ADD COLUMN IF NOT EXISTS "projectPhaseId" TEXT;
CREATE INDEX IF NOT EXISTS "SfTimeEntry_projectPhaseId_idx" ON "SfTimeEntry"("projectPhaseId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfProjectPhase_projectId_fkey') THEN
    ALTER TABLE "SfProjectPhase" ADD CONSTRAINT "SfProjectPhase_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "SfProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfProjectTask_projectPhaseId_fkey') THEN
    ALTER TABLE "SfProjectTask" ADD CONSTRAINT "SfProjectTask_projectPhaseId_fkey"
      FOREIGN KEY ("projectPhaseId") REFERENCES "SfProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicket_projectPhaseId_fkey') THEN
    ALTER TABLE "SfTicket" ADD CONSTRAINT "SfTicket_projectPhaseId_fkey"
      FOREIGN KEY ("projectPhaseId") REFERENCES "SfProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTimeEntry_projectPhaseId_fkey') THEN
    ALTER TABLE "SfTimeEntry" ADD CONSTRAINT "SfTimeEntry_projectPhaseId_fkey"
      FOREIGN KEY ("projectPhaseId") REFERENCES "SfProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
