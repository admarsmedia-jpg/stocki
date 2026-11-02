-- Bug 5: barcode must be unique when non-null
-- Drop old non-unique index first, then recreate as unique
DROP INDEX IF EXISTS items_barcode_idx;
CREATE UNIQUE INDEX IF NOT EXISTS items_barcode_unique_idx ON items(barcode) WHERE barcode IS NOT NULL;
