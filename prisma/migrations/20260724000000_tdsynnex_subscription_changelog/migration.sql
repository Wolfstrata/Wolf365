-- TD SYNNEX subscription change-log storage (listSubscriptionChangeLogs).
-- Captures the exact date + seat delta of co-terminous mid-month seat additions,
-- which are otherwise invisible on the subscription payload. Idempotent.

CREATE TABLE IF NOT EXISTS "TdSynnexSubscriptionChangeLog" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "stellrSubscriptionId" TEXT NOT NULL,
  "customerNo" TEXT,
  "contractNo" TEXT,
  "lineNo" INTEGER,
  "activityLog" TEXT,
  "changeLog" TEXT,
  "seatsDelta" INTEGER NOT NULL DEFAULT 0,
  "entryDatetime" TIMESTAMP(3) NOT NULL,
  "entryBy" TEXT,
  "entrySource" TEXT,
  "raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TdSynnexSubscriptionChangeLog_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TdSynnexSubscriptionChangeLog_subscriptionId_fkey'
  ) THEN
    ALTER TABLE "TdSynnexSubscriptionChangeLog"
      ADD CONSTRAINT "TdSynnexSubscriptionChangeLog_subscriptionId_fkey"
      FOREIGN KEY ("subscriptionId") REFERENCES "TdSynnexSubscription"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TdSynnexSubscriptionChangeLog_uniq_changelog_entry"
  ON "TdSynnexSubscriptionChangeLog" ("stellrSubscriptionId", "entryDatetime", "changeLog");

CREATE INDEX IF NOT EXISTS "TdSynnexSubscriptionChangeLog_subscriptionId_idx"
  ON "TdSynnexSubscriptionChangeLog" ("subscriptionId");

CREATE INDEX IF NOT EXISTS "TdSynnexSubscriptionChangeLog_entryDatetime_idx"
  ON "TdSynnexSubscriptionChangeLog" ("entryDatetime");
