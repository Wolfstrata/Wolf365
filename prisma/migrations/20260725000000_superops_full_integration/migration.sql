-- Full SuperOps integration: enrich clients + add sites, contacts, assets,
-- contracts, tickets, worklogs, and a resumable sync checkpoint. Idempotent.

-- Enrich SuperOpsClient with account fields.
ALTER TABLE "SuperOpsClient" ADD COLUMN IF NOT EXISTS "stage" TEXT;
ALTER TABLE "SuperOpsClient" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "SuperOpsClient" ADD COLUMN IF NOT EXISTS "accountManager" TEXT;
ALTER TABLE "SuperOpsClient" ADD COLUMN IF NOT EXISTS "emailDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS "SuperOpsClient_name_idx" ON "SuperOpsClient"("name");

CREATE TABLE IF NOT EXISTS "SuperOpsSite" (
    "id" TEXT NOT NULL,
    "superOpsClientId" TEXT NOT NULL,
    "superOpsId" TEXT NOT NULL,
    "name" TEXT,
    "timezone" TEXT,
    "address" JSONB,
    "raw" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuperOpsSite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SuperOpsContact" (
    "id" TEXT NOT NULL,
    "superOpsClientId" TEXT NOT NULL,
    "superOpsId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "raw" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuperOpsContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SuperOpsAsset" (
    "id" TEXT NOT NULL,
    "superOpsClientId" TEXT NOT NULL,
    "superOpsId" TEXT NOT NULL,
    "name" TEXT,
    "serialNumber" TEXT,
    "platform" TEXT,
    "status" TEXT,
    "lastCommunicatedTime" TIMESTAMP(3),
    "raw" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuperOpsAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SuperOpsContract" (
    "id" TEXT NOT NULL,
    "superOpsClientId" TEXT NOT NULL,
    "superOpsId" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "raw" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuperOpsContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SuperOpsTicket" (
    "id" TEXT NOT NULL,
    "superOpsClientId" TEXT,
    "superOpsId" TEXT NOT NULL,
    "displayId" TEXT,
    "subject" TEXT,
    "status" TEXT,
    "priority" TEXT,
    "technician" TEXT,
    "createdTime" TIMESTAMP(3),
    "updatedTime" TIMESTAMP(3),
    "raw" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuperOpsTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SuperOpsWorklog" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "superOpsClientId" TEXT,
    "superOpsId" TEXT NOT NULL,
    "technician" TEXT,
    "minutes" INTEGER,
    "billable" BOOLEAN,
    "notes" TEXT,
    "entryTime" TIMESTAMP(3),
    "raw" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuperOpsWorklog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SuperOpsSyncState" (
    "entity" TEXT NOT NULL,
    "cursor" TEXT,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SuperOpsSyncState_pkey" PRIMARY KEY ("entity")
);

-- Unique business keys.
CREATE UNIQUE INDEX IF NOT EXISTS "SuperOpsSite_superOpsId_key" ON "SuperOpsSite"("superOpsId");
CREATE UNIQUE INDEX IF NOT EXISTS "SuperOpsContact_superOpsId_key" ON "SuperOpsContact"("superOpsId");
CREATE UNIQUE INDEX IF NOT EXISTS "SuperOpsAsset_superOpsId_key" ON "SuperOpsAsset"("superOpsId");
CREATE UNIQUE INDEX IF NOT EXISTS "SuperOpsContract_superOpsId_key" ON "SuperOpsContract"("superOpsId");
CREATE UNIQUE INDEX IF NOT EXISTS "SuperOpsTicket_superOpsId_key" ON "SuperOpsTicket"("superOpsId");
CREATE UNIQUE INDEX IF NOT EXISTS "SuperOpsWorklog_superOpsId_key" ON "SuperOpsWorklog"("superOpsId");

-- Lookup indexes.
CREATE INDEX IF NOT EXISTS "SuperOpsSite_superOpsClientId_idx" ON "SuperOpsSite"("superOpsClientId");
CREATE INDEX IF NOT EXISTS "SuperOpsContact_superOpsClientId_idx" ON "SuperOpsContact"("superOpsClientId");
CREATE INDEX IF NOT EXISTS "SuperOpsAsset_superOpsClientId_idx" ON "SuperOpsAsset"("superOpsClientId");
CREATE INDEX IF NOT EXISTS "SuperOpsContract_superOpsClientId_idx" ON "SuperOpsContract"("superOpsClientId");
CREATE INDEX IF NOT EXISTS "SuperOpsTicket_superOpsClientId_idx" ON "SuperOpsTicket"("superOpsClientId");
CREATE INDEX IF NOT EXISTS "SuperOpsTicket_updatedTime_idx" ON "SuperOpsTicket"("updatedTime");
CREATE INDEX IF NOT EXISTS "SuperOpsTicket_status_idx" ON "SuperOpsTicket"("status");
CREATE INDEX IF NOT EXISTS "SuperOpsWorklog_ticketId_idx" ON "SuperOpsWorklog"("ticketId");
CREATE INDEX IF NOT EXISTS "SuperOpsWorklog_superOpsClientId_idx" ON "SuperOpsWorklog"("superOpsClientId");
CREATE INDEX IF NOT EXISTS "SuperOpsWorklog_entryTime_idx" ON "SuperOpsWorklog"("entryTime");

-- Foreign keys (guarded so re-apply is safe).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SuperOpsSite_superOpsClientId_fkey') THEN
    ALTER TABLE "SuperOpsSite" ADD CONSTRAINT "SuperOpsSite_superOpsClientId_fkey" FOREIGN KEY ("superOpsClientId") REFERENCES "SuperOpsClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SuperOpsContact_superOpsClientId_fkey') THEN
    ALTER TABLE "SuperOpsContact" ADD CONSTRAINT "SuperOpsContact_superOpsClientId_fkey" FOREIGN KEY ("superOpsClientId") REFERENCES "SuperOpsClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SuperOpsAsset_superOpsClientId_fkey') THEN
    ALTER TABLE "SuperOpsAsset" ADD CONSTRAINT "SuperOpsAsset_superOpsClientId_fkey" FOREIGN KEY ("superOpsClientId") REFERENCES "SuperOpsClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SuperOpsContract_superOpsClientId_fkey') THEN
    ALTER TABLE "SuperOpsContract" ADD CONSTRAINT "SuperOpsContract_superOpsClientId_fkey" FOREIGN KEY ("superOpsClientId") REFERENCES "SuperOpsClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SuperOpsTicket_superOpsClientId_fkey') THEN
    ALTER TABLE "SuperOpsTicket" ADD CONSTRAINT "SuperOpsTicket_superOpsClientId_fkey" FOREIGN KEY ("superOpsClientId") REFERENCES "SuperOpsClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SuperOpsWorklog_ticketId_fkey') THEN
    ALTER TABLE "SuperOpsWorklog" ADD CONSTRAINT "SuperOpsWorklog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SuperOpsTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SuperOpsWorklog_superOpsClientId_fkey') THEN
    ALTER TABLE "SuperOpsWorklog" ADD CONSTRAINT "SuperOpsWorklog_superOpsClientId_fkey" FOREIGN KEY ("superOpsClientId") REFERENCES "SuperOpsClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
