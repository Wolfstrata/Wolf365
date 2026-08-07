-- Drop PROJECT and TIME_AND_MATERIALS from SfAgreementType.
--
-- Neither was an agreement. Project work is its own record with its own billing
-- type (SfProject.billingType), and "time and materials" is what happens when
-- hours are logged against a client with NO agreement — already the billing
-- generator's default path. Offering both as agreement types produced records
-- that duplicated a concept living somewhere better.
--
-- Postgres cannot drop a value from an enum, so the type is recreated and the
-- column swapped onto it. Guarded and idempotent: if the new shape is already in
-- place the whole thing is a no-op.
--
-- IMPORTANT: this deliberately REFUSES rather than reassigning. An agreement's
-- type decides how its work bills, so quietly turning a TIME_AND_MATERIALS
-- agreement into a BLOCK_TIME one would change what a client is charged without
-- anyone deciding to. If the exception fires, reassign or delete those agreements
-- and deploy again — the message says how many there are.
DO $$
DECLARE
  offending integer;
BEGIN
  -- Nothing to do if the values are already gone.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'SfAgreementType'
      AND e.enumlabel IN ('PROJECT', 'TIME_AND_MATERIALS')
  ) THEN
    RAISE NOTICE 'SfAgreementType already trimmed — nothing to do.';
    RETURN;
  END IF;

  SELECT count(*) INTO offending
  FROM "SfAgreement"
  WHERE type::text IN ('PROJECT', 'TIME_AND_MATERIALS');

  IF offending > 0 THEN
    RAISE EXCEPTION
      'Cannot remove PROJECT / TIME_AND_MATERIALS from SfAgreementType: % agreement(s) still use them. '
      'Reassign each to Block time, Managed services or Managed NOC (or delete it) and deploy again. '
      'They are not remapped automatically because an agreement''s type decides how its work bills.',
      offending;
  END IF;

  -- Recreate the type with only the three real kinds, then move the column over.
  CREATE TYPE "SfAgreementType_new" AS ENUM ('BLOCK_TIME', 'MANAGED_SERVICES', 'MANAGED_NOC');

  ALTER TABLE "SfAgreement"
    ALTER COLUMN "type" TYPE "SfAgreementType_new"
    USING ("type"::text::"SfAgreementType_new");

  DROP TYPE "SfAgreementType";
  ALTER TYPE "SfAgreementType_new" RENAME TO "SfAgreementType";
END $$;
