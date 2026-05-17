-- Up Migration
-- Vacations module: trip planning + history of family stays (Airbnb, chalets, hotels...).
--
-- Design notes:
--   * One row per trip in `vacations` with destination + dates + accommodation.
--   * Participants live in a join table so we can filter "who came on which trip"
--     and not duplicate denormalized name/color (already on family_members).
--   * Itinerary days and luggage items are stored in their own tables (not JSONB)
--     because the UI needs to PATCH single items frequently (toggle "packed",
--     edit one activity) and we want indexes on vacation_id for cheap fetches.
--   * `status` is derived from dates at read-time in most places, but persisting
--     it allows manual override (e.g. user marks a trip cancelled).
--   * Post-trip review fields (rating, review_text, actual_cost) are nullable
--     and filled after the trip ends — they are what makes "Historique" useful.

CREATE TABLE IF NOT EXISTS vacations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(160) NOT NULL,
    destination VARCHAR(160) NOT NULL,
    country VARCHAR(80),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    -- planning | upcoming | ongoing | past | cancelled
    status VARCHAR(20) NOT NULL DEFAULT 'planning',
    -- airbnb | chalet | hotel | camping | family | other
    accommodation_type VARCHAR(20),
    accommodation_name VARCHAR(160),
    accommodation_url TEXT,
    accommodation_address TEXT,
    accommodation_contact TEXT,
    budget_planned NUMERIC(10, 2),
    actual_cost NUMERIC(10, 2),
    -- Free-form list of trip objectives ("détente", "culture", "sport"…).
    -- Drives the AI planner in PR2.
    objectives TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    notes TEXT,
    rating SMALLINT CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
    review_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT vacations_dates_chk CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_vacations_user ON vacations(user_id);
CREATE INDEX IF NOT EXISTS idx_vacations_user_status ON vacations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_vacations_user_dates ON vacations(user_id, start_date, end_date);

CREATE TRIGGER update_vacations_updated_at
    BEFORE UPDATE ON vacations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS vacation_participants (
    vacation_id UUID NOT NULL REFERENCES vacations(id) ON DELETE CASCADE,
    family_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
    PRIMARY KEY (vacation_id, family_member_id)
);

CREATE INDEX IF NOT EXISTS idx_vacation_participants_member
    ON vacation_participants(family_member_id);

CREATE TABLE IF NOT EXISTS vacation_itinerary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vacation_id UUID NOT NULL REFERENCES vacations(id) ON DELETE CASCADE,
    day_number INT NOT NULL,
    date DATE NOT NULL,
    theme VARCHAR(80),
    -- [{id: uuid, title: string, time?: "HH:MM", duration_min?: int, cost?: number, notes?: string}, …]
    activities JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- [{meal: "breakfast"|"lunch"|"dinner", suggestion: string, restaurant?: string, cost?: number}, …]
    meals_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
    estimated_cost NUMERIC(10, 2),
    transport_notes TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (vacation_id, day_number)
);

CREATE INDEX IF NOT EXISTS idx_vacation_itinerary_vacation
    ON vacation_itinerary(vacation_id, day_number);

CREATE TRIGGER update_vacation_itinerary_updated_at
    BEFORE UPDATE ON vacation_itinerary
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS vacation_luggage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vacation_id UUID NOT NULL REFERENCES vacations(id) ON DELETE CASCADE,
    -- NULL = shared/family checklist; otherwise the owner of the item.
    family_member_id UUID REFERENCES family_members(id) ON DELETE CASCADE,
    -- clothing | toiletries | documents | health | electronics | kids | misc
    category VARCHAR(20) NOT NULL DEFAULT 'misc',
    item VARCHAR(160) NOT NULL,
    quantity SMALLINT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    packed BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vacation_luggage_vacation
    ON vacation_luggage(vacation_id);
CREATE INDEX IF NOT EXISTS idx_vacation_luggage_member
    ON vacation_luggage(vacation_id, family_member_id);

CREATE TRIGGER update_vacation_luggage_updated_at
    BEFORE UPDATE ON vacation_luggage
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Down Migration
DROP TRIGGER IF EXISTS update_vacation_luggage_updated_at ON vacation_luggage;
DROP INDEX IF EXISTS idx_vacation_luggage_member;
DROP INDEX IF EXISTS idx_vacation_luggage_vacation;
DROP TABLE IF EXISTS vacation_luggage;

DROP TRIGGER IF EXISTS update_vacation_itinerary_updated_at ON vacation_itinerary;
DROP INDEX IF EXISTS idx_vacation_itinerary_vacation;
DROP TABLE IF EXISTS vacation_itinerary;

DROP INDEX IF EXISTS idx_vacation_participants_member;
DROP TABLE IF EXISTS vacation_participants;

DROP TRIGGER IF EXISTS update_vacations_updated_at ON vacations;
DROP INDEX IF EXISTS idx_vacations_user_dates;
DROP INDEX IF EXISTS idx_vacations_user_status;
DROP INDEX IF EXISTS idx_vacations_user;
DROP TABLE IF EXISTS vacations;
