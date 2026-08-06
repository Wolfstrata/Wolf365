-- Master switch for all outbound SilverFang email.
--
-- HARD RULE: off by default, and a missing row also means off — so email cannot
-- start flowing merely because this table has not been populated yet. No row is
-- inserted here on purpose: the application treats absence as "disabled", and
-- seeding a row would only create somewhere for a future default to be wrong.
CREATE TABLE IF NOT EXISTS "SfEmailPolicy" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "outboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SfEmailPolicy_pkey" PRIMARY KEY ("id")
);
