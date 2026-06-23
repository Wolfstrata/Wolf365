-- Capture TD SYNNEX suggested customer price on subscriptions.
ALTER TABLE "TdSynnexSubscription" ADD COLUMN "customerPrice" DECIMAL(18,4);
