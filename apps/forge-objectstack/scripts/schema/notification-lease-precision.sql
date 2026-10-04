-- The application and its messaging workers must be stopped.
-- Canonical successor of scripts/schema/20260923-fix-notification-lease-precision.sql.
-- ObjectStack 17.3 uses epoch milliseconds for these native notification leases.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE sys_notification_delivery
  ALTER COLUMN claimed_at TYPE double precision USING claimed_at::double precision,
  ALTER COLUMN next_attempt_at TYPE double precision USING next_attempt_at::double precision,
  ALTER COLUMN last_attempted_at TYPE double precision USING last_attempted_at::double precision;

UPDATE sys_notification_delivery
SET status = 'pending', claimed_by = NULL, claimed_at = NULL, next_attempt_at = 0
WHERE status = 'in_flight';

COMMIT;
