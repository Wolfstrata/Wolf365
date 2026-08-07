-- SilverFang inbound mail events: one row per decided message.
--
-- Idempotent throughout (IF NOT EXISTS / guarded DO blocks), because a migration
-- that half-applies wedges the whole chain, and this schema is applied both by the
-- Vercel production build and occasionally by hand in the Neon console.

CREATE TABLE IF NOT EXISTS "SfMailEvent" (
  "id"          TEXT NOT NULL,
  "mailboxId"   TEXT,
  "decision"    TEXT NOT NULL,
  "detail"      TEXT,
  "fromAddress" TEXT,
  "subject"     TEXT,
  "messageId"   TEXT,
  "externalId"  TEXT,
  "ticketId"    TEXT,
  "receivedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SfMailEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SfMailEvent_createdAt_idx" ON "SfMailEvent" ("createdAt");
CREATE INDEX IF NOT EXISTS "SfMailEvent_mailboxId_createdAt_idx" ON "SfMailEvent" ("mailboxId", "createdAt");
CREATE INDEX IF NOT EXISTS "SfMailEvent_decision_createdAt_idx" ON "SfMailEvent" ("decision", "createdAt");

-- Both foreign keys are ON DELETE SET NULL: the record of a decision stays
-- meaningful after the mailbox is removed or the ticket is deleted, and losing the
-- history would defeat the point of keeping it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SfMailEvent_mailboxId_fkey'
  ) THEN
    ALTER TABLE "SfMailEvent"
      ADD CONSTRAINT "SfMailEvent_mailboxId_fkey"
      FOREIGN KEY ("mailboxId") REFERENCES "SfMailbox"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SfMailEvent_ticketId_fkey'
  ) THEN
    ALTER TABLE "SfMailEvent"
      ADD CONSTRAINT "SfMailEvent_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "SfTicket"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
