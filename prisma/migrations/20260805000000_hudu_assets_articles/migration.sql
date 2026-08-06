-- Hudu sync: richer companies, plus their assets and article links, so
-- SilverFang can show what Hudu already knows about a client.
--
-- SECURITY: Hudu is also a credential vault. There is deliberately no table for
-- Hudu password records, HuduAsset carries no `raw` column (a raw copy would
-- reinstate the confidential fields the sync strips), and HuduArticle stores
-- titles and links only — never article bodies, which routinely embed
-- credentials.
ALTER TABLE "HuduCompany"
  ADD COLUMN IF NOT EXISTS "nickname" TEXT,
  ADD COLUMN IF NOT EXISTS "companyType" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "website" TEXT,
  ADD COLUMN IF NOT EXISTS "idNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "huduUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "HuduCompany_name_idx" ON "HuduCompany"("name");

CREATE TABLE IF NOT EXISTS "HuduAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "huduId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetLayout" TEXT,
    "serial" TEXT,
    "model" TEXT,
    "manufacturer" TEXT,
    "primaryMail" TEXT,
    "huduUrl" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "fields" JSONB,
    "redactedFieldCount" INTEGER NOT NULL DEFAULT 0,
    "huduUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HuduAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "HuduAsset_huduId_key" ON "HuduAsset"("huduId");
CREATE INDEX IF NOT EXISTS "HuduAsset_companyId_name_idx" ON "HuduAsset"("companyId", "name");
CREATE INDEX IF NOT EXISTS "HuduAsset_assetLayout_idx" ON "HuduAsset"("assetLayout");

CREATE TABLE IF NOT EXISTS "HuduArticle" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "huduId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "folder" TEXT,
    "huduUrl" TEXT,
    "global" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "huduUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HuduArticle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "HuduArticle_huduId_key" ON "HuduArticle"("huduId");
CREATE INDEX IF NOT EXISTS "HuduArticle_companyId_name_idx" ON "HuduArticle"("companyId", "name");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HuduAsset_companyId_fkey') THEN
    ALTER TABLE "HuduAsset" ADD CONSTRAINT "HuduAsset_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "HuduCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HuduArticle_companyId_fkey') THEN
    ALTER TABLE "HuduArticle" ADD CONSTRAINT "HuduArticle_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "HuduCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
