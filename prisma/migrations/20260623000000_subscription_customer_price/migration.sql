-- Capture TD SYNNEX suggested customer price on subscriptions. Idempotent.
ALTER TABLE "TdSynnexSubscription" ADD COLUMN IF NOT EXISTS "customerPrice" DECIMAL(18,4);
