-- Per-rep sales compensation: base salary + product commission % (of gross
-- margin) + a services-commission multiplier on the standard month-of-MRR
-- schedule. Idempotent.

CREATE TABLE IF NOT EXISTS "SalesRepComp" (
  "id"                           TEXT NOT NULL,
  "userId"                       TEXT NOT NULL,
  "baseSalary"                   DECIMAL(18,2) NOT NULL DEFAULT 0,
  "productCommissionPct"         DECIMAL(6,3) NOT NULL DEFAULT 0,
  "servicesCommissionMultiplier" DECIMAL(6,3) NOT NULL DEFAULT 1,
  "createdAt"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesRepComp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SalesRepComp_userId_key" ON "SalesRepComp" ("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalesRepComp_userId_fkey') THEN
    ALTER TABLE "SalesRepComp"
      ADD CONSTRAINT "SalesRepComp_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REP_COMP_SET';
