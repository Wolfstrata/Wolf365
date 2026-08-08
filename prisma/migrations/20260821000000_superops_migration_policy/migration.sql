-- The SuperOps → SilverFang cutover switch.
--
-- One row for the whole install: either SuperOps is still a source of data or
-- SilverFang is the source of truth. A per-connector toggle would allow a
-- half-on state, which is what produces contradictions nobody can explain.
--
-- Defaults to enabled, so applying this changes nothing for an install that is
-- still mid-migration. The row is created on demand by the app, not seeded here.

CREATE TABLE IF NOT EXISTS "SfMigrationPolicy" (
  "id"              TEXT NOT NULL DEFAULT 'singleton',
  "superOpsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "cutoverAt"       TIMESTAMP(3),
  "notes"           TEXT,
  "updatedByEmail"  TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SfMigrationPolicy_pkey" PRIMARY KEY ("id")
);
