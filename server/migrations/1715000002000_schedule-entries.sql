-- Up Migration
-- Schedule entries for weekly work/school planning, with optional
-- specific_date for one-off entries (vs recurring weekly).

CREATE TABLE IF NOT EXISTS schedule_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
    schedule_type VARCHAR(30) NOT NULL DEFAULT 'work',
    title VARCHAR(255) NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 1 AND day_of_week <= 7),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    specific_date DATE,
    location TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schedule_entries_user_day
    ON schedule_entries(user_id, day_of_week);

CREATE INDEX IF NOT EXISTS idx_schedule_entries_member
    ON schedule_entries(family_member_id);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_schedule_entries_updated_at'
    ) THEN
        CREATE TRIGGER update_schedule_entries_updated_at
        BEFORE UPDATE ON schedule_entries
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Down Migration
DROP TABLE IF EXISTS schedule_entries CASCADE;
