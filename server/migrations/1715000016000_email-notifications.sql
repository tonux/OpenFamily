-- Up Migration
-- Email notifications. Doubles the existing in-app notifications by sending
-- them out via SMTP (Resend). Two opt-in modes per user:
--   - immediate: each notification fires its own email shortly after creation
--   - daily:     a single 8h digest groups everything from the last 24h
-- The toggle (`email_notifications_enabled`) takes precedence — if false, the
-- worker skips the user entirely regardless of the digest mode.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS email_digest_mode VARCHAR(20) NOT NULL DEFAULT 'immediate';

-- Per-row tracking on existing notifications. `email_sent_at` doubles as the
-- "already processed" flag (both for immediate and digest modes). `email_attempts`
-- caps retries so a permanently failing recipient doesn't loop forever.
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_attempts SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS email_last_error TEXT;

-- Partial index powers the worker's hot query: find unsent, still-retryable
-- notifications, ordered by creation. Keeps the index tiny since once an email
-- is sent the row falls out.
CREATE INDEX IF NOT EXISTS idx_notifications_email_pending
    ON notifications (created_at)
    WHERE email_sent_at IS NULL AND email_attempts < 5;

-- Down Migration
DROP INDEX IF EXISTS idx_notifications_email_pending;

ALTER TABLE notifications
    DROP COLUMN IF EXISTS email_last_error,
    DROP COLUMN IF EXISTS email_attempts,
    DROP COLUMN IF EXISTS email_sent_at;

ALTER TABLE users
    DROP COLUMN IF EXISTS email_digest_mode,
    DROP COLUMN IF EXISTS email_notifications_enabled;
