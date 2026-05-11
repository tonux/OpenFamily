-- Up Migration
-- Issue #40 / #43: support cross-midnight hours, per-week (non-recurring)
-- entries, and a location column for schedule entries.

ALTER TABLE schedule_entries
    DROP CONSTRAINT IF EXISTS schedule_entries_check;

ALTER TABLE schedule_entries
    ADD COLUMN IF NOT EXISTS specific_date DATE;

ALTER TABLE schedule_entries
    ADD COLUMN IF NOT EXISTS location TEXT;

-- Down Migration
ALTER TABLE schedule_entries DROP COLUMN IF EXISTS location;
ALTER TABLE schedule_entries DROP COLUMN IF EXISTS specific_date;
-- We don't restore the cross-midnight constraint on rollback — older
-- installations that need it should re-add it manually.
