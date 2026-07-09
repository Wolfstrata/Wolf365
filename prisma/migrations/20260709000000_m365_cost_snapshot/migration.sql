-- Monthly M365 (TD SYNNEX) per-subscription cost/price snapshot, so cost
-- changes can be compared month-over-month. Idempotent.

CREATE TABLE IF NOT EXISTS "M365CostSnapshot" (
  "id"                   TEXT NOT NULL,
  "periodMonth"          TIMESTAMP(3) NOT NULL,
  "stellrSubscriptionId" TEXT NOT NULL,
  "customerId"           TEXT NOT NULL,
  "productSku"           TEXT,
  "productName"          TEXT,
  "quantity"             INTEGER NOT NULL DEFAULT 0,
  "unitCost"             DECIMAL(18,4),
  "customerPrice"        DECIMAL(18,4),
  "currency"             TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "M365CostSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "M365CostSnapshot_periodMonth_stellrSubscriptionId_key"
  ON "M365CostSnapshot" ("periodMonth", "stellrSubscriptionId");
CREATE INDEX IF NOT EXISTS "M365CostSnapshot_stellrSubscriptionId_periodMonth_idx"
  ON "M365CostSnapshot" ("stellrSubscriptionId", "periodMonth");
CREATE INDEX IF NOT EXISTS "M365CostSnapshot_customerId_periodMonth_idx"
  ON "M365CostSnapshot" ("customerId", "periodMonth");
