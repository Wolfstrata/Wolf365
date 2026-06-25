-- Track when an imported opportunity is edited inside Wolf365. Once set, the
-- Salesforce sync skips the row so local edits are never overwritten.
ALTER TABLE "CrmOpportunity" ADD COLUMN IF NOT EXISTS "locallyModifiedAt" TIMESTAMP(3);
