-- Reclassify existing CRM opportunities into the correct line based on a
-- keyword in the opportunity name. Requested as a one-time cleanup.
--
--   * name contains "365"  -> M365         (covers "365", "M365", "Microsoft 365")
--   * name contains "NOC"  -> MANAGED_NOC  (only when it does NOT also match 365)
--
-- Matching is case-insensitive (ILIKE). Where a name matches both keywords,
-- M365 wins (the NOC update excludes 365 matches), so each row lands in exactly
-- one line. Applied once by `prisma migrate deploy`.

UPDATE "CrmOpportunity"
SET "line" = 'M365'::"CrmLine"
WHERE "name" ILIKE '%365%'
  AND "line" <> 'M365';

UPDATE "CrmOpportunity"
SET "line" = 'MANAGED_NOC'::"CrmLine"
WHERE "name" ILIKE '%noc%'
  AND "name" NOT ILIKE '%365%'
  AND "line" <> 'MANAGED_NOC';
