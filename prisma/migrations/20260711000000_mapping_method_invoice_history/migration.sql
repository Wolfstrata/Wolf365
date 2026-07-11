-- Add INVOICE_HISTORY to MappingMethod so mappings learned from QBO invoice
-- history during sync are distinguishable (and countable). Idempotent.

ALTER TYPE "MappingMethod" ADD VALUE IF NOT EXISTS 'INVOICE_HISTORY';
