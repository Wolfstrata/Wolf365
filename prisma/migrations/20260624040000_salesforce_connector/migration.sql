-- Salesforce connector + opportunity import provenance. Idempotent.

ALTER TYPE "ConnectorType" ADD VALUE IF NOT EXISTS 'SALESFORCE';

ALTER TABLE "CrmOpportunity" ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT;
ALTER TABLE "CrmOpportunity" ADD COLUMN IF NOT EXISTS "externalId" TEXT;

-- Upsert key for imported records (multiple NULLs are allowed by Postgres, so
-- manually-created opportunities are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS "CrmOpportunity_sourceSystem_externalId_key"
  ON "CrmOpportunity"("sourceSystem", "externalId");
