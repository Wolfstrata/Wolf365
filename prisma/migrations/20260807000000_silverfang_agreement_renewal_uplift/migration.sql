-- Auto-renew uplift: the percentage an agreement's prices rise by when its term
-- renews. 15% is the house standard, so it is the column default and applies to
-- existing rows too — an auto-renewing agreement that renewed at 0% would be a
-- silent revenue loss, and NULL here would mean exactly that.
--
-- The uplift is never applied automatically. Renewing changes what a client pays,
-- so SilverFang computes and shows it and a person confirms it — the same rule
-- that keeps invoices from auto-pushing. `lastRenewedAt` is what stops a second
-- confirmation from compounding the increase.
ALTER TABLE "SfAgreement"
  ADD COLUMN IF NOT EXISTS "renewalIncreasePercent" DECIMAL(5,2) NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "lastRenewedAt" TIMESTAMP(3);
