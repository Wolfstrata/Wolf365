-- SilverFang: multiple assignees per ticket.
--
-- `SfTicket."assigneeId"` stays as the PRIMARY assignee and is not dropped — the
-- ASSIGNEE audience on auto-responses, utilisation reporting and the "unassigned"
-- count all need a single owner. This table is the full set, primary included.
--
-- The backfill at the end is what keeps the two consistent from the first
-- deploy: every ticket that already has an assignee gets the matching row, so
-- "everyone on this ticket" is never emptier than "the primary assignee".
--
-- Idempotent throughout, because a half-applied migration once wedged the chain.

CREATE TABLE IF NOT EXISTS "SfTicketAssignee" (
  "ticketId"     TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "addedById"    TEXT,
  "addedByEmail" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SfTicketAssignee_pkey" PRIMARY KEY ("ticketId", "userId")
);

CREATE INDEX IF NOT EXISTS "SfTicketAssignee_userId_idx" ON "SfTicketAssignee"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SfTicketAssignee_ticketId_fkey'
  ) THEN
    ALTER TABLE "SfTicketAssignee"
      ADD CONSTRAINT "SfTicketAssignee_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "SfTicket"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SfTicketAssignee_userId_fkey'
  ) THEN
    ALTER TABLE "SfTicketAssignee"
      ADD CONSTRAINT "SfTicketAssignee_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill from the existing single assignee. ON CONFLICT DO NOTHING makes the
-- whole statement safe to run again.
INSERT INTO "SfTicketAssignee" ("ticketId", "userId")
SELECT "id", "assigneeId" FROM "SfTicket" WHERE "assigneeId" IS NOT NULL
ON CONFLICT DO NOTHING;
