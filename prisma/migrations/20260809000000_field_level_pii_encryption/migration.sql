-- Field-level encryption for personal data, plus the lookup columns it needs.
--
-- SfContact.email / phone / mobile, SfTicket.description, SfTicketNote.body and
-- SfTicketMessage.fromAddress / bodyText / bodyHtml now hold AES-256-GCM
-- ciphertext written by src/lib/crypto.ts, on top of Neon's encryption at rest.
--
-- NO DATA IS CONVERTED HERE, on purpose. The read path tolerates plaintext
-- (`decryptField` checks the envelope shape first), so existing rows keep working
-- and are converted by the backfill in Administration → Security & SSO. Doing it
-- in SQL is not possible anyway — the key lives in the application, not the
-- database, which is the entire point of encrypting above the storage layer.
--
-- Two new columns exist because an encrypted column cannot be queried:
--
--   emailIndex  — keyed blind index (HMAC) of the lowercased address, so a
--                 contact can still be found by email. Equality only.
--   emailDomain — the domain in the clear, because inbound routing matches an
--                 unknown sender to a client by domain. The domain identifies the
--                 company, whose name is already stored; the local part, which
--                 identifies the person, stays encrypted.
ALTER TABLE "SfContact"
  ADD COLUMN IF NOT EXISTS "emailIndex" TEXT,
  ADD COLUMN IF NOT EXISTS "emailDomain" TEXT;

CREATE INDEX IF NOT EXISTS "SfContact_emailIndex_idx" ON "SfContact"("emailIndex");
CREATE INDEX IF NOT EXISTS "SfContact_emailDomain_idx" ON "SfContact"("emailDomain");

-- The old index was on the address itself. Once that column holds randomised
-- ciphertext no query can use it, so it is only costing writes and disk.
DROP INDEX IF EXISTS "SfContact_email_idx";
