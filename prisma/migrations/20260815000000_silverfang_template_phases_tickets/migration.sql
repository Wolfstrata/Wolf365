-- Project templates gain phases and ticket stubs, and carry the project's shape.
--
-- Templates previously held only a flat task list with a free-text phase name, so a
-- template could not reproduce the thing that actually matters about a project: its
-- phases, the hours sold against each, and the tickets that live in them.
--
-- Deliberately no client, agreement, manager or dates on a template. Those are what
-- make a project a specific piece of work rather than a reusable shape, and copying
-- them would mean every project generated from a template started out belonging to
-- whoever the template was captured from.
--
-- Idempotent throughout, so this is safe to re-run and safe to paste into the Neon
-- console.

-- Project shape defaults on the template itself.
ALTER TABLE "SfProjectTemplate" ADD COLUMN IF NOT EXISTS "billingType" "SfProjectBillingType" NOT NULL DEFAULT 'TIME_AND_MATERIALS';
ALTER TABLE "SfProjectTemplate" ADD COLUMN IF NOT EXISTS "contractedHours" DECIMAL(18,4);
ALTER TABLE "SfProjectTemplate" ADD COLUMN IF NOT EXISTS "estimatedHours" DECIMAL(18,4);
ALTER TABLE "SfProjectTemplate" ADD COLUMN IF NOT EXISTS "fixedFeeAmount" DECIMAL(18,2);
ALTER TABLE "SfProjectTemplate" ADD COLUMN IF NOT EXISTS "billingIntervalDays" INTEGER;
ALTER TABLE "SfProjectTemplate" ADD COLUMN IF NOT EXISTS "depositPercent" DECIMAL(5,2);
ALTER TABLE "SfProjectTemplate" ADD COLUMN IF NOT EXISTS "sourceProjectId" TEXT;

-- Phases.
CREATE TABLE IF NOT EXISTS "SfProjectTemplatePhase" (
  "id"         TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  "hours"      DECIMAL(18,4),
  "notes"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SfProjectTemplatePhase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SfProjectTemplatePhase_templateId_sortOrder_idx"
  ON "SfProjectTemplatePhase" ("templateId", "sortOrder");

-- Ticket stubs.
CREATE TABLE IF NOT EXISTS "SfProjectTemplateTicket" (
  "id"              TEXT NOT NULL,
  "templateId"      TEXT NOT NULL,
  "templatePhaseId" TEXT,
  "summary"         TEXT NOT NULL,
  "description"     TEXT,
  "priority"        "SfTicketPriority" NOT NULL DEFAULT 'P3',
  "estimatedHours"  DECIMAL(18,4),
  "sortOrder"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SfProjectTemplateTicket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SfProjectTemplateTicket_templateId_sortOrder_idx"
  ON "SfProjectTemplateTicket" ("templateId", "sortOrder");
CREATE INDEX IF NOT EXISTS "SfProjectTemplateTicket_templatePhaseId_idx"
  ON "SfProjectTemplateTicket" ("templatePhaseId");

-- Tasks can now name a real phase. The legacy free-text `phase` column stays, so
-- templates written before this migration generate exactly as they did.
ALTER TABLE "SfProjectTemplateTask" ADD COLUMN IF NOT EXISTS "templatePhaseId" TEXT;
CREATE INDEX IF NOT EXISTS "SfProjectTemplateTask_templatePhaseId_idx"
  ON "SfProjectTemplateTask" ("templatePhaseId");

-- Foreign keys. Phases and tickets CASCADE from the template — they have no meaning
-- without it. The phase links are SET NULL, so deleting a phase leaves its tasks and
-- tickets in the template rather than deleting work somebody wrote.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfProjectTemplatePhase_templateId_fkey') THEN
    ALTER TABLE "SfProjectTemplatePhase"
      ADD CONSTRAINT "SfProjectTemplatePhase_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "SfProjectTemplate"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfProjectTemplateTicket_templateId_fkey') THEN
    ALTER TABLE "SfProjectTemplateTicket"
      ADD CONSTRAINT "SfProjectTemplateTicket_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "SfProjectTemplate"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfProjectTemplateTicket_templatePhaseId_fkey') THEN
    ALTER TABLE "SfProjectTemplateTicket"
      ADD CONSTRAINT "SfProjectTemplateTicket_templatePhaseId_fkey"
      FOREIGN KEY ("templatePhaseId") REFERENCES "SfProjectTemplatePhase"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfProjectTemplateTask_templatePhaseId_fkey') THEN
    ALTER TABLE "SfProjectTemplateTask"
      ADD CONSTRAINT "SfProjectTemplateTask_templatePhaseId_fkey"
      FOREIGN KEY ("templatePhaseId") REFERENCES "SfProjectTemplatePhase"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
