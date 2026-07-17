-- QuickBooks vendor-bill + bill-payment snapshots that power the Suppliers &
-- Expenses / DPO report (how long we take to pay suppliers/expenses).
-- Mirrors QboInvoice / QboPayment. Idempotent.

CREATE TABLE IF NOT EXISTS "QboBill" (
  "id"           TEXT NOT NULL,
  "qboId"        TEXT NOT NULL,
  "realmId"      TEXT NOT NULL,
  "vendorRef"    TEXT,
  "vendorName"   TEXT,
  "docNumber"    TEXT,
  "category"     TEXT,
  "memo"         TEXT,
  "txnDate"      TIMESTAMP(3) NOT NULL,
  "dueDate"      TIMESTAMP(3),
  "totalAmount"  DECIMAL(18,2) NOT NULL DEFAULT 0,
  "balance"      DECIMAL(18,2) NOT NULL DEFAULT 0,
  "currency"     TEXT,
  "raw"          JSONB,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QboBill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QboBill_qboId_key" ON "QboBill" ("qboId");
CREATE INDEX IF NOT EXISTS "QboBill_realmId_idx" ON "QboBill" ("realmId");
CREATE INDEX IF NOT EXISTS "QboBill_vendorRef_idx" ON "QboBill" ("vendorRef");
CREATE INDEX IF NOT EXISTS "QboBill_txnDate_idx" ON "QboBill" ("txnDate");

CREATE TABLE IF NOT EXISTS "QboBillPayment" (
  "id"           TEXT NOT NULL,
  "qboId"        TEXT NOT NULL,
  "realmId"      TEXT NOT NULL,
  "vendorRef"    TEXT,
  "vendorName"   TEXT,
  "txnDate"      TIMESTAMP(3) NOT NULL,
  "totalAmount"  DECIMAL(18,2) NOT NULL DEFAULT 0,
  "currency"     TEXT,
  "lines"        JSONB,
  "raw"          JSONB,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QboBillPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QboBillPayment_qboId_key" ON "QboBillPayment" ("qboId");
CREATE INDEX IF NOT EXISTS "QboBillPayment_realmId_idx" ON "QboBillPayment" ("realmId");
CREATE INDEX IF NOT EXISTS "QboBillPayment_vendorRef_idx" ON "QboBillPayment" ("vendorRef");
CREATE INDEX IF NOT EXISTS "QboBillPayment_txnDate_idx" ON "QboBillPayment" ("txnDate");
