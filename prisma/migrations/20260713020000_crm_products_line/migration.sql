-- New CRM line "Products" — a catch-all for Salesforce-synced product
-- opportunities that aren't Managed Services, Managed NOC, or Microsoft 365. Idempotent.

ALTER TYPE "CrmLine" ADD VALUE IF NOT EXISTS 'PRODUCTS';
