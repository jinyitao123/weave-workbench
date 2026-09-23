-- Run while the Forge application is stopped.
-- ObjectStack notification leases store epoch milliseconds. PostgreSQL REAL
-- rounds those values, so the dispatcher cannot match its own claim during
-- acknowledgement and repeatedly delivers the same inbox message.
BEGIN;

ALTER TABLE sys_notification_delivery
  ALTER COLUMN claimed_at TYPE double precision USING claimed_at::double precision,
  ALTER COLUMN next_attempt_at TYPE double precision USING next_attempt_at::double precision,
  ALTER COLUMN last_attempted_at TYPE double precision USING last_attempted_at::double precision;

UPDATE sys_notification_delivery
SET status = 'pending',
    claimed_by = NULL,
    claimed_at = NULL,
    next_attempt_at = 0
WHERE status = 'in_flight';

COMMIT;
