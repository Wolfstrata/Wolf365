-- SilverFang: technicians authorised to log time against an agreement or project.
--
-- A whitelist, and empty deliberately means everyone: if the presence of a row
-- set were read as "restricted", creating these tables would instantly have
-- stopped every technician logging time against every existing agreement.
--
-- Idempotent throughout — IF NOT EXISTS on the tables and indexes, and guarded
-- pg_constraint blocks on the foreign keys — because a half-applied migration
-- once wedged the whole chain.

CREATE TABLE IF NOT EXISTS "SfAgreementTech" (
  "agreementId"    TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "grantedById"    TEXT,
  "grantedByEmail" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SfAgreementTech_pkey" PRIMARY KEY ("agreementId", "userId")
);

CREATE INDEX IF NOT EXISTS "SfAgreementTech_userId_idx" ON "SfAgreementTech"("userId");

CREATE TABLE IF NOT EXISTS "SfProjectTech" (
  "projectId"      TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "grantedById"    TEXT,
  "grantedByEmail" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SfProjectTech_pkey" PRIMARY KEY ("projectId", "userId")
);

CREATE INDEX IF NOT EXISTS "SfProjectTech_userId_idx" ON "SfProjectTech"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SfAgreementTech_agreementId_fkey'
  ) THEN
    ALTER TABLE "SfAgreementTech"
      ADD CONSTRAINT "SfAgreementTech_agreementId_fkey"
      FOREIGN KEY ("agreementId") REFERENCES "SfAgreement"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SfAgreementTech_userId_fkey'
  ) THEN
    ALTER TABLE "SfAgreementTech"
      ADD CONSTRAINT "SfAgreementTech_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SfProjectTech_projectId_fkey'
  ) THEN
    ALTER TABLE "SfProjectTech"
      ADD CONSTRAINT "SfProjectTech_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "SfProject"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SfProjectTech_userId_fkey'
  ) THEN
    ALTER TABLE "SfProjectTech"
      ADD CONSTRAINT "SfProjectTech_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
