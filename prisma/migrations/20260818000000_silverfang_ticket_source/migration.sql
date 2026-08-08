-- SilverFang: provenance on a ticket, so tickets can be imported idempotently.
--
-- The unique pair is what makes a re-import find the same ticket rather than
-- duplicate it — whether the run overwrites it or deliberately leaves it alone.
-- Nullable, because a ticket raised in Wolf365 has no source and two of those
-- must not collide: in Postgres, NULLs are distinct in a unique index, so any
-- number of rows may have (NULL, NULL).

ALTER TABLE "SfTicket" ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT;
ALTER TABLE "SfTicket" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "SfTicket" ADD COLUMN IF NOT EXISTS "sourceUpdatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "SfTicket_sourceSystem_externalId_key"
  ON "SfTicket"("sourceSystem", "externalId");
