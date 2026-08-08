-- SilverFang: provenance on a time entry, so SuperOps worklogs can be imported
-- without ever being counted twice.
--
-- Duplicated hours are the worst outcome an import can produce — they inflate
-- utilisation, draw down a client's prepaid block twice, and reach an invoice.
-- The unique pair is what makes a re-import find the same entry instead.
--
-- Nullable: an entry logged by hand has no source, and NULLs are distinct in a
-- Postgres unique index, so any number of (NULL, NULL) rows coexist.

ALTER TABLE "SfTimeEntry" ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT;
ALTER TABLE "SfTimeEntry" ADD COLUMN IF NOT EXISTS "externalId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "SfTimeEntry_sourceSystem_externalId_key"
  ON "SfTimeEntry"("sourceSystem", "externalId");
