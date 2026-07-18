-- Capture QBO ExchangeRate per document so foreign-currency (e.g. USD) invoices,
-- payments, bills and bill-payments can be converted to the home currency (CAD)
-- for reporting. Home-currency units per one foreign unit; 1 for home-currency
-- docs. Idempotent.

ALTER TABLE "QboInvoice"     ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "QboPayment"     ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "QboBill"        ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "QboBillPayment" ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1;
