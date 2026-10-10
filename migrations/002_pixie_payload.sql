-- Preserve the original City-approved cargo alongside the delivery ledger.
ALTER TABLE pixie_deliveries ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE pixie_deliveries ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
