-- SilverFang clients: per-client PSA profile, plus provenance columns on SfContact so
-- imports (e.g. from SuperOps) update rather than duplicate on re-run. Idempotent.

-- Contact provenance. The (sourceSystem, externalId) pair is the import key, matching
-- the CrmOpportunity convention. Null for contacts created by hand.
ALTER TABLE "SfContact" ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT;
ALTER TABLE "SfContact" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "SfContact" ADD COLUMN IF NOT EXISTS "sourceUpdatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "SfContact_sourceSystem_externalId_key"
  ON "SfContact"("sourceSystem", "externalId");

CREATE TABLE IF NOT EXISTS "SfClientProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "accountManager" TEXT,
    "defaultBoardId" TEXT,
    "defaultAgreementId" TEXT,
    "vip" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SfClientProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SfClientProfile_clientId_key" ON "SfClientProfile"("clientId");
CREATE INDEX IF NOT EXISTS "SfClientProfile_defaultBoardId_idx" ON "SfClientProfile"("defaultBoardId");
CREATE INDEX IF NOT EXISTS "SfClientProfile_defaultAgreementId_idx" ON "SfClientProfile"("defaultAgreementId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfClientProfile_clientId_fkey') THEN
    ALTER TABLE "SfClientProfile" ADD CONSTRAINT "SfClientProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfClientProfile_defaultBoardId_fkey') THEN
    ALTER TABLE "SfClientProfile" ADD CONSTRAINT "SfClientProfile_defaultBoardId_fkey" FOREIGN KEY ("defaultBoardId") REFERENCES "SfBoard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SfClientProfile_defaultAgreementId_fkey') THEN
    ALTER TABLE "SfClientProfile" ADD CONSTRAINT "SfClientProfile_defaultAgreementId_fkey" FOREIGN KEY ("defaultAgreementId") REFERENCES "SfAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
