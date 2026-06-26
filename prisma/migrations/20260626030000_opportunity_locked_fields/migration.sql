-- Field-level sync protection: the DB columns a user has edited in Wolf365.
-- The Salesforce sync skips exactly these columns. Idempotent.
ALTER TABLE "CrmOpportunity"
  ADD COLUMN IF NOT EXISTS "lockedFields" TEXT[] NOT NULL DEFAULT '{}';
