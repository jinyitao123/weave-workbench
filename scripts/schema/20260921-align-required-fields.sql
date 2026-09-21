BEGIN;

ALTER TABLE forge_fixed_asset
  ALTER COLUMN owner_name SET NOT NULL,
  ALTER COLUMN department SET NOT NULL,
  ALTER COLUMN purchase_on SET NOT NULL,
  ALTER COLUMN original_value SET NOT NULL,
  ALTER COLUMN accumulated_depreciation SET NOT NULL;

ALTER TABLE forge_material_pickup_request
  ALTER COLUMN purpose SET NOT NULL;

ALTER TABLE forge_qualification_record
  ALTER COLUMN issuing_authority SET NOT NULL,
  ALTER COLUMN valid_from SET NOT NULL,
  ALTER COLUMN valid_to SET NOT NULL;

COMMIT;
