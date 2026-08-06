-- HARD RULE: no client is emailed unless someone explicitly turns it on for that
-- client. Default false, and existing rows are forced false rather than relying
-- on the column default — a client that predates this column has never been
-- opted in, so it must not be treated as opted in.
--
-- A client with no SfClientProfile row is also "not allowed": the application
-- treats a missing row as a refusal, so no backfill of profile rows happens here
-- (creating them would only invite a future default flipping the wrong way).
ALTER TABLE "SfClientProfile"
  ADD COLUMN IF NOT EXISTS "allowClientEmail" BOOLEAN NOT NULL DEFAULT false;

UPDATE "SfClientProfile" SET "allowClientEmail" = false;
