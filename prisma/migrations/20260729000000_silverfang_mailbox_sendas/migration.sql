-- SilverFang mailbox: reply-as address and a start-from cutoff.
--
-- `sendAsAddress` supports the common front-door topology where a shared address
-- forwards into a real mailbox (support@ → help@): poll the real mailbox, answer
-- as the address the client wrote to.
--
-- `ignoreBefore` stops a newly-added mailbox from working through its existing
-- history creating tickets. Existing rows are backfilled to the moment this
-- migration runs, which is the safe reading of "don't touch what came before".
ALTER TABLE "SfMailbox" ADD COLUMN IF NOT EXISTS "sendAsAddress" TEXT;
ALTER TABLE "SfMailbox" ADD COLUMN IF NOT EXISTS "ignoreBefore" TIMESTAMP(3);

UPDATE "SfMailbox" SET "ignoreBefore" = CURRENT_TIMESTAMP WHERE "ignoreBefore" IS NULL;
