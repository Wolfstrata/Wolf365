-- Vendor/publisher on TD SYNNEX subscriptions, so the app can focus on
-- Microsoft 365 and exclude other lines (e.g. Cisco) that Stellr also resells.
-- Idempotent; backfills existing rows from the stored raw payload.

ALTER TABLE "TdSynnexSubscription" ADD COLUMN IF NOT EXISTS "vendor" TEXT;

UPDATE "TdSynnexSubscription"
SET "vendor" = COALESCE(
  "raw"->>'vendorName',
  "raw"->>'vendor',
  "raw"->>'publisher',
  "raw"->>'manufacturer',
  "raw"->>'mfrName',
  "raw"->>'brand'
)
WHERE "vendor" IS NULL AND "raw" IS NOT NULL;
