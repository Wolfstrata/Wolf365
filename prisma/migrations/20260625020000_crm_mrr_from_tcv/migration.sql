-- Establish the permanent invariant for CRM opportunities: MRR is the total
-- contract value (TCV) divided by 12, and monthly margin is the margin TCV
-- divided by 12. This backfills every existing opportunity (Managed Services,
-- Managed NOC and M365) to match the import rule "Amount maps to TCV; MRR =
-- TCV / 12".
--
-- The monthly figures are derived from the amount / marginAmount columns, which
-- this migration does NOT modify, so re-running produces the same result
-- (idempotent). Rows without a TCV keep their existing monthly value.
UPDATE "CrmOpportunity"
SET
  "monthlyAmount" = CASE
    WHEN "amount" IS NOT NULL THEN ROUND("amount" / 12.0, 2)
    ELSE "monthlyAmount"
  END,
  "monthlyMargin" = CASE
    WHEN "marginAmount" IS NOT NULL THEN ROUND("marginAmount" / 12.0, 2)
    ELSE "monthlyMargin"
  END,
  "marginPercentage" = CASE
    WHEN "amount" IS NOT NULL AND "amount" <> 0 AND "marginAmount" IS NOT NULL
      THEN ROUND("marginAmount" / "amount" * 100, 2)
    ELSE "marginPercentage"
  END;
