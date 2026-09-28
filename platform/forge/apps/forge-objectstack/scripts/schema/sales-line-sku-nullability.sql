-- Forward-only compatibility migration for first-class service lines.
-- The current object metadata and sales actions keep material SKU validation;
-- this only relaxes the stale physical NOT NULL constraints in existing DBs.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
  line_table text;
BEGIN
  FOREACH line_table IN ARRAY ARRAY['forge_sales_contract_line', 'forge_sales_order_line'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = line_table
        AND column_name = 'sku_id'
    ) THEN
      EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN sku_id DROP NOT NULL', current_schema(), line_table);
    END IF;
  END LOOP;
END
$migration$;

-- A previous draft Action persisted responsible_id/created_by but omitted the
-- platform ownership field used by the sales operator's own-record read scope.
-- Only restore drafts whose creator and responsible employee already agree.
DO $migration$
BEGIN
  IF (
    SELECT COUNT(*) = 4
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'forge_sales_contract'
      AND column_name IN ('owner_id', 'created_by', 'responsible_id', 'status')
  ) THEN
    UPDATE forge_sales_contract
    SET owner_id = responsible_id
    WHERE owner_id IS NULL
      AND status = 'draft'
      AND created_by = responsible_id
      AND responsible_id IS NOT NULL;
  END IF;
END
$migration$;

COMMIT;
