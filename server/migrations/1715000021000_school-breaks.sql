-- Up Migration
-- School breaks: the periods during which the kids are home instead of at school.
--
-- Drives the dashboard's "day context" (see server/src/lib/dayContext.ts), which
-- decides whether tomorrow is a school day (→ show the outfit for school) or a
-- home day (→ show screen-free activity suggestions).
--
-- Deliberately user-declared rather than synced from a national school calendar:
-- the app is not France-only, and holiday zones/dates differ per country and per
-- académie. The resolver ships a July–August fallback so a user who declares
-- nothing still gets the summer behaviour out of the box.
--
-- Ranges are inclusive on both ends and MAY overlap — the resolver only asks
-- "is this date covered by any row?", so overlapping periods are harmless.

CREATE TABLE IF NOT EXISTS school_breaks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT school_breaks_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_school_breaks_user_dates
    ON school_breaks(user_id, start_date, end_date);

CREATE TRIGGER update_school_breaks_updated_at
    BEFORE UPDATE ON school_breaks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Down Migration
DROP TRIGGER IF EXISTS update_school_breaks_updated_at ON school_breaks;
DROP TABLE IF EXISTS school_breaks;
