-- Track which tickets have had their conversation asked for.
--
-- SuperOps caps API calls at 100/minute and answers the overflow with an
-- HTTP 200 carrying a generic DataFetchingException, so the per-ticket note
-- mirror cannot run in one pass. Without a record of what has already been
-- checked, every re-run starts from the top and re-spends the whole minute's
-- quota on the same tickets it already has.
ALTER TABLE "SuperOpsTicket" ADD COLUMN IF NOT EXISTS "notesCheckedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "SuperOpsTicket_notesCheckedAt_idx"
  ON "SuperOpsTicket" ("notesCheckedAt");
