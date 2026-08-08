-- Remove project tasks. The project ticket is the unit of work.
--
-- Tasks were a second unit of work alongside project tickets, and having both
-- meant every piece of work had two places it could live. This drops them.
--
-- THE ORDER MATTERS. Time entries and tickets could reach a project *through* a
-- task, so dropping the link first would orphan them: a time entry whose only
-- route to a project was its task would stop being billable, and stop appearing
-- on the project at all. So each is re-pointed at the task's own phase first,
-- which is the same project by a shorter path, and only then is the link dropped.
--
-- Idempotent: the updates match nothing once the columns are gone, and every DDL
-- statement is guarded.

-- 1. Preserve time entries: inherit the task's phase where the entry has none.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'SfTimeEntry' AND column_name = 'projectTaskId'
  ) THEN
    UPDATE "SfTimeEntry" e
       SET "projectPhaseId" = t."projectPhaseId"
      FROM "SfProjectTask" t
     WHERE e."projectTaskId" = t."id"
       AND e."projectPhaseId" IS NULL
       AND t."projectPhaseId" IS NOT NULL;
  END IF;
END $$;

-- 2. Same for tickets that hung off a task rather than a phase.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'SfTicket' AND column_name = 'projectTaskId'
  ) THEN
    UPDATE "SfTicket" k
       SET "projectPhaseId" = t."projectPhaseId"
      FROM "SfProjectTask" t
     WHERE k."projectTaskId" = t."id"
       AND k."projectPhaseId" IS NULL
       AND t."projectPhaseId" IS NOT NULL;

    UPDATE "SfTicket" k
       SET "projectId" = t."projectId"
      FROM "SfProjectTask" t
     WHERE k."projectTaskId" = t."id"
       AND k."projectId" IS NULL;
  END IF;
END $$;

-- 3. Now the links can go without taking anything with them.
ALTER TABLE "SfTimeEntry" DROP COLUMN IF EXISTS "projectTaskId";
ALTER TABLE "SfTicket"    DROP COLUMN IF EXISTS "projectTaskId";

-- 4. And the tables themselves. CASCADE clears the foreign keys that pointed at
--    them; by this point nothing of value is on the other end.
DROP TABLE IF EXISTS "SfProjectTemplateTask" CASCADE;
DROP TABLE IF EXISTS "SfProjectTask" CASCADE;
