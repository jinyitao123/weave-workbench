-- The application and its messaging workers must be stopped.
-- Canonical successor of scripts/schema/20260923-fix-notification-lease-precision.sql.
-- ObjectStack 17.3 REAL columns cannot preserve every epoch-millisecond token.
-- Keep native 17.5 NUMERIC and already-migrated DOUBLE PRECISION columns intact.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE col record;
DECLARE imprecise_claims boolean := false;
BEGIN
  FOR col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'sys_notification_delivery'
      AND column_name IN ('claimed_at', 'next_attempt_at', 'last_attempted_at')
      AND data_type = 'real'
  LOOP
    IF col.column_name = 'claimed_at' THEN imprecise_claims := true; END IF;
    EXECUTE format('ALTER TABLE %I.sys_notification_delivery ALTER COLUMN %I TYPE double precision USING %I::double precision', current_schema(), col.column_name, col.column_name);
  END LOOP;

  -- The original token cannot be recovered from a rounded REAL claim. Only
  -- this legacy claim column warrants retiring its in-flight credentials;
  -- widening retry/attempt times alone must preserve precise active claims.
  IF imprecise_claims THEN
    UPDATE sys_notification_delivery
    SET status = 'pending', claimed_by = NULL, claimed_at = NULL, next_attempt_at = 0
    WHERE status = 'in_flight';
  END IF;
END
$migration$;

COMMIT;
