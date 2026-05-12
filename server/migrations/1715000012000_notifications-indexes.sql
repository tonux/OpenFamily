-- Up Migration
-- Phase 3: notifications system. The `notifications` table exists since the
-- initial schema but was never wired up. Add the indexes the new feature
-- needs:
--   - `(user_id, is_read, created_at DESC)` powers the bell-icon list and
--     the "unread count" badge (filtered + ordered, hottest path of the app).
--   - `(user_id, type, related_id)` powers the dedup check that the cron
--     scheduler runs before INSERTing a notification, so re-running the
--     same job a few times a day doesn't spam the user.

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created
    ON notifications (user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_dedup
    ON notifications (user_id, type, related_id, created_at DESC)
    WHERE related_id IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_notifications_dedup;
DROP INDEX IF EXISTS idx_notifications_user_unread_created;
