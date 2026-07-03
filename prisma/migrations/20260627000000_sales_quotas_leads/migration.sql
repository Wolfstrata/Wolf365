-- Sales management (quota targets) + Leads (external ingestion). Idempotent.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'QUOTA_SET';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LEAD_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LEADS_IMPORTED';

CREATE TABLE IF NOT EXISTS "SalesQuota" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "year"         INTEGER NOT NULL,
  "quarter"      INTEGER NOT NULL DEFAULT 0,
  "targetAmount" DECIMAL(18,2) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesQuota_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SalesQuota_userId_year_quarter_key"
  ON "SalesQuota" ("userId", "year", "quarter");
CREATE INDEX IF NOT EXISTS "SalesQuota_year_idx" ON "SalesQuota" ("year");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SalesQuota_userId_fkey'
  ) THEN
    ALTER TABLE "SalesQuota"
      ADD CONSTRAINT "SalesQuota_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Lead" (
  "id"         TEXT NOT NULL,
  "externalId" TEXT,
  "firstName"  TEXT,
  "lastName"   TEXT,
  "fullName"   TEXT,
  "company"    TEXT,
  "title"      TEXT,
  "email"      TEXT,
  "phone"      TEXT,
  "website"    TEXT,
  "source"     TEXT NOT NULL DEFAULT 'zoominfo',
  "status"     TEXT NOT NULL DEFAULT 'NEW',
  "notes"      TEXT,
  "raw"        JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Lead_externalId_key" ON "Lead" ("externalId");
CREATE INDEX IF NOT EXISTS "Lead_status_idx" ON "Lead" ("status");
CREATE INDEX IF NOT EXISTS "Lead_email_idx" ON "Lead" ("email");
CREATE INDEX IF NOT EXISTS "Lead_createdAt_idx" ON "Lead" ("createdAt");
