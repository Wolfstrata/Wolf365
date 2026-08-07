-- Link a calendar event to the time block it represents.
--
-- SfCalendarLink existed from the original SilverFang schema but had no code
-- behind it and no way to say which block an event was for. The unique constraint
-- is the point: one block owns at most one event, so a re-sync updates what is
-- there instead of creating a second event every pass.
--
-- Idempotent throughout, so this is safe to re-run and safe to paste into the Neon
-- console.

ALTER TABLE "SfCalendarLink" ADD COLUMN IF NOT EXISTS "timeEntryId" TEXT;
ALTER TABLE "SfCalendarLink" ADD COLUMN IF NOT EXISTS "lastError" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "SfCalendarLink_timeEntryId_key"
  ON "SfCalendarLink" ("timeEntryId");

-- ON DELETE CASCADE: an event exists because a block does. Delete the block and
-- the row goes too — the Graph event is removed by the service before the row is,
-- so nothing is orphaned in the mailbox.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SfCalendarLink_timeEntryId_fkey'
  ) THEN
    ALTER TABLE "SfCalendarLink"
      ADD CONSTRAINT "SfCalendarLink_timeEntryId_fkey"
      FOREIGN KEY ("timeEntryId") REFERENCES "SfTimeEntry"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
