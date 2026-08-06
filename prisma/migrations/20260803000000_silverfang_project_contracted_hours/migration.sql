-- Hours sold for a project: the quantity the client agreed to, distinct from the
-- internal estimate. Overage on a project is measured against this, the way a
-- block-time agreement's overage is measured against its purchased hours.
--
-- Nullable and left NULL on existing rows: a project that predates this has no
-- contracted quantity, and defaulting it to the estimate would invent a
-- commitment nobody made.
ALTER TABLE "SfProject" ADD COLUMN IF NOT EXISTS "contractedHours" DECIMAL(18,4);
