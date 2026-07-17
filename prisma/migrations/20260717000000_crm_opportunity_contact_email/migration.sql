-- Customer contact email (from Salesforce) on CRM opportunities. Its domain
-- identifies the client for Microsoft 365 touchpoint matching. Idempotent.

ALTER TABLE "CrmOpportunity" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;
