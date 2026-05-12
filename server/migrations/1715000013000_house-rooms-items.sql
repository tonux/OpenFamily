-- Up Migration
-- Phase 4 of the "Maison" section: rooms + items registry.
--
-- Two-table model intentionally flat. Hierarchical sub-locations (drawers,
-- shelves) live in a free-text `location_detail` column on items rather than
-- a third table — most foyers have ≤ 100 items and a deeper hierarchy
-- multiplies UI cost without proportional value. If/when a real
-- sub-location need emerges (parents tracking 500 toys?), promote it.
--
-- Items are nullable on `room_id` so a freshly created item can be saved
-- before deciding where it lives, and so deleting a room doesn't cascade-
-- delete its items (better UX: items become "à ranger").

CREATE TABLE IF NOT EXISTS house_rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    -- Free-form text in DB; the API enforces the enum.
    category VARCHAR(32) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#3B82F6',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_house_rooms_user ON house_rooms(user_id);

CREATE TABLE IF NOT EXISTS house_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id UUID REFERENCES house_rooms(id) ON DELETE SET NULL,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(32) NOT NULL,
    quantity INTEGER,
    -- Free-text "tiroir du haut", "étagère verte" — explicit enough for
    -- "où est X" lookups without modelling a fuller hierarchy.
    location_detail VARCHAR(120),
    photo_url TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_house_items_user ON house_items(user_id);
CREATE INDEX IF NOT EXISTS idx_house_items_room ON house_items(room_id) WHERE room_id IS NOT NULL;
-- Used by the "Où est X ?" search across all rooms; trgm would be ideal
-- but pulling the extension is overkill at < 200 rows per user. ILIKE on
-- this index helps the planner.
CREATE INDEX IF NOT EXISTS idx_house_items_name_lower
    ON house_items(user_id, lower(name));

CREATE TRIGGER update_house_rooms_updated_at
    BEFORE UPDATE ON house_rooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_house_items_updated_at
    BEFORE UPDATE ON house_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Down Migration
DROP TRIGGER IF EXISTS update_house_items_updated_at ON house_items;
DROP TRIGGER IF EXISTS update_house_rooms_updated_at ON house_rooms;
DROP INDEX IF EXISTS idx_house_items_name_lower;
DROP INDEX IF EXISTS idx_house_items_room;
DROP INDEX IF EXISTS idx_house_items_user;
DROP TABLE IF EXISTS house_items;
DROP INDEX IF EXISTS idx_house_rooms_user;
DROP TABLE IF EXISTS house_rooms;
