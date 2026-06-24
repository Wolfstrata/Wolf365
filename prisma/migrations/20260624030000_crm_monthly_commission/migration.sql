-- Opportunities are entered as monthly figures; TCV and commission are derived.
-- Idempotent.
ALTER TABLE "CrmOpportunity" ADD COLUMN IF NOT EXISTS "monthlyAmount" DECIMAL(18,2);
ALTER TABLE "CrmOpportunity" ADD COLUMN IF NOT EXISTS "monthlyMargin" DECIMAL(18,2);
ALTER TABLE "CrmOpportunity" ADD COLUMN IF NOT EXISTS "commissionAmount" DECIMAL(18,2);
