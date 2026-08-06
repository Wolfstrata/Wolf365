-- Field-level change trail for SilverFang records without a history table of
-- their own. Append-only by convention, so "who changed what, from what, when"
-- survives later edits and deletions.
--
-- Also splits the audit actions that were being funnelled through
-- SILVERFANG_CONFIG_CHANGED, so the trail can be filtered by what actually
-- changed rather than by one catch-all.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SF_CONTACT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SF_CONTACT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SF_CONTACT_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SF_CLIENT_PROFILE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SF_MAILBOX_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SF_EMAIL_POLICY_CHANGED';

CREATE TABLE IF NOT EXISTS "SfChangeLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "operation" TEXT NOT NULL DEFAULT 'UPDATE',
    "actorId" TEXT,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SfChangeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SfChangeLog_entity_entityId_createdAt_idx"
    ON "SfChangeLog"("entity", "entityId", "createdAt");
CREATE INDEX IF NOT EXISTS "SfChangeLog_createdAt_idx" ON "SfChangeLog"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfChangeLog_actorId_fkey') THEN
        ALTER TABLE "SfChangeLog" ADD CONSTRAINT "SfChangeLog_actorId_fkey"
            FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
