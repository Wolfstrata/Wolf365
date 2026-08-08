-- SuperOps ticket notes/conversations: the read-only mirror, and provenance on
-- the SilverFang note they import into.
--
-- This is migration plumbing. The team is moving off SuperOps, so ticket history
-- has to come across too — a migrated ticket with no conversation is a ticket
-- nobody can pick up.

CREATE TABLE IF NOT EXISTS "SuperOpsTicketNote" (
  "id"           TEXT NOT NULL,
  "ticketId"     TEXT,
  "superOpsId"   TEXT NOT NULL,
  "kind"         TEXT,
  "isPrivate"    BOOLEAN,
  "author"       TEXT,
  "authorEmail"  TEXT,
  "body"         TEXT,
  "createdTime"  TIMESTAMP(3),
  "raw"          JSONB,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SuperOpsTicketNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SuperOpsTicketNote_superOpsId_key"
  ON "SuperOpsTicketNote"("superOpsId");
CREATE INDEX IF NOT EXISTS "SuperOpsTicketNote_ticketId_createdTime_idx"
  ON "SuperOpsTicketNote"("ticketId", "createdTime");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SuperOpsTicketNote_ticketId_fkey'
  ) THEN
    ALTER TABLE "SuperOpsTicketNote"
      ADD CONSTRAINT "SuperOpsTicketNote_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "SuperOpsTicket"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Provenance on the SilverFang note. Nullable, because a note written here has no
-- source and NULLs are distinct in a Postgres unique index.
ALTER TABLE "SfTicketNote" ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT;
ALTER TABLE "SfTicketNote" ADD COLUMN IF NOT EXISTS "externalId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "SfTicketNote_sourceSystem_externalId_key"
  ON "SfTicketNote"("sourceSystem", "externalId");
