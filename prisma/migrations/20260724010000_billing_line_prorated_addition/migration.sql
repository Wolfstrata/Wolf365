-- Flag billing lines that cover mid-period seat additions (pro-rated, split off
-- the base subscription line) so the run UI can label them as separate items.
ALTER TABLE "BillingLine"
  ADD COLUMN IF NOT EXISTS "isProratedAddition" BOOLEAN NOT NULL DEFAULT false;
