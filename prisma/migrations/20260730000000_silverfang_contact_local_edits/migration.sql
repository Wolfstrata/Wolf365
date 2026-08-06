-- Track when a SilverFang contact is edited by hand inside Wolf365. Once set,
-- the SuperOps import skips that contact so a re-import never reverts a local
-- correction — the same lock CrmOpportunity.locallyModifiedAt provides for the
-- Salesforce sync.
--
-- Existing rows stay NULL: they were imported and have not been edited, so the
-- import should keep maintaining them.
ALTER TABLE "SfContact" ADD COLUMN IF NOT EXISTS "locallyModifiedAt" TIMESTAMP(3);
