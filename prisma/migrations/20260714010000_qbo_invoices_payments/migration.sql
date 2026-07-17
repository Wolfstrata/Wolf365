-- QuickBooks invoice + received-payment snapshots that power the Cash-Flow / DSO
-- report (payment tiers, DSO, cash-flow drag, YoY movers). Idempotent.

CREATE TABLE IF NOT EXISTS "QboInvoice" (
  "id"           TEXT NOT NULL,
  "qboId"        TEXT NOT NULL,
  "realmId"      TEXT NOT NULL,
  "customerRef"  TEXT,
  "customerName" TEXT,
  "docNumber"    TEXT,
  "txnDate"      TIMESTAMP(3) NOT NULL,
  "dueDate"      TIMESTAMP(3),
  "totalAmount"  DECIMAL(18,2) NOT NULL DEFAULT 0,
  "balance"      DECIMAL(18,2) NOT NULL DEFAULT 0,
  "currency"     TEXT,
  "termName"     TEXT,
  "raw"          JSONB,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QboInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QboInvoice_qboId_key" ON "QboInvoice" ("qboId");
CREATE INDEX IF NOT EXISTS "QboInvoice_realmId_idx" ON "QboInvoice" ("realmId");
CREATE INDEX IF NOT EXISTS "QboInvoice_customerRef_idx" ON "QboInvoice" ("customerRef");
CREATE INDEX IF NOT EXISTS "QboInvoice_txnDate_idx" ON "QboInvoice" ("txnDate");

CREATE TABLE IF NOT EXISTS "QboPayment" (
  "id"           TEXT NOT NULL,
  "qboId"        TEXT NOT NULL,
  "realmId"      TEXT NOT NULL,
  "customerRef"  TEXT,
  "customerName" TEXT,
  "txnDate"      TIMESTAMP(3) NOT NULL,
  "totalAmount"  DECIMAL(18,2) NOT NULL DEFAULT 0,
  "currency"     TEXT,
  "lines"        JSONB,
  "raw"          JSONB,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QboPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QboPayment_qboId_key" ON "QboPayment" ("qboId");
CREATE INDEX IF NOT EXISTS "QboPayment_realmId_idx" ON "QboPayment" ("realmId");
CREATE INDEX IF NOT EXISTS "QboPayment_customerRef_idx" ON "QboPayment" ("customerRef");
CREATE INDEX IF NOT EXISTS "QboPayment_txnDate_idx" ON "QboPayment" ("txnDate");
