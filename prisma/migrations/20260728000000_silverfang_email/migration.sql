-- SilverFang ticket email (inbound + outbound).
--
-- Adds the support-mailbox configuration SilverFang polls and replies from, links
-- ticket messages to the mailbox that carried them, and records email traffic in
-- the audit trail. Idempotent throughout: safe to re-run and safe to apply to a
-- database where an earlier attempt got part way.

-- New audit actions. ALTER TYPE ... ADD VALUE IF NOT EXISTS cannot run inside a
-- transaction block on older servers, but Prisma applies each statement
-- separately, and IF NOT EXISTS makes a repeat run a no-op.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TICKET_EMAIL_SENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TICKET_EMAIL_RECEIVED';

-- Support mailboxes.
CREATE TABLE IF NOT EXISTS "SfMailbox" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "name" TEXT,
    "boardId" TEXT,
    "fallbackClientId" TEXT,
    "defaultPriority" "SfTicketPriority" NOT NULL DEFAULT 'P3',
    "provider" TEXT NOT NULL DEFAULT 'GRAPH',
    "inbound" BOOLEAN NOT NULL DEFAULT true,
    "outbound" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "signature" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "lastPollError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SfMailbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SfMailbox_address_key" ON "SfMailbox"("address");
CREATE INDEX IF NOT EXISTS "SfMailbox_active_inbound_idx" ON "SfMailbox"("active", "inbound");
CREATE INDEX IF NOT EXISTS "SfMailbox_boardId_idx" ON "SfMailbox"("boardId");
CREATE INDEX IF NOT EXISTS "SfMailbox_fallbackClientId_idx" ON "SfMailbox"("fallbackClientId");

-- Link ticket messages to the mailbox that sent/received them.
ALTER TABLE "SfTicketMessage" ADD COLUMN IF NOT EXISTS "mailboxId" TEXT;
CREATE INDEX IF NOT EXISTS "SfTicketMessage_mailboxId_receivedAt_idx"
    ON "SfTicketMessage"("mailboxId", "receivedAt");

-- Foreign keys, each guarded so a partial earlier run does not wedge the chain.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfMailbox_boardId_fkey') THEN
        ALTER TABLE "SfMailbox" ADD CONSTRAINT "SfMailbox_boardId_fkey"
            FOREIGN KEY ("boardId") REFERENCES "SfBoard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfMailbox_fallbackClientId_fkey') THEN
        ALTER TABLE "SfMailbox" ADD CONSTRAINT "SfMailbox_fallbackClientId_fkey"
            FOREIGN KEY ("fallbackClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfTicketMessage_mailboxId_fkey') THEN
        ALTER TABLE "SfTicketMessage" ADD CONSTRAINT "SfTicketMessage_mailboxId_fkey"
            FOREIGN KEY ("mailboxId") REFERENCES "SfMailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
