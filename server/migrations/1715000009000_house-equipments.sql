-- Up Migration
-- Phase 1 of the "Maison" section: track household equipment (boilers,
-- appliances, vehicles, …) and the maintenance log for each. Recurrence is
-- handled at the route layer (PATCH performed_date → INSERT next planned
-- occurrence). Future modules (contracts, contacts, rooms, projects) will
-- live in additional house_* tables under the same /api/house surface.

CREATE TABLE IF NOT EXISTS house_equipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    -- Free-form text in DB; the API enforces the enum via zod so future
    -- categories don't require a schema migration.
    category VARCHAR(32) NOT NULL,
    brand VARCHAR(80),
    model VARCHAR(80),
    serial_number VARCHAR(80),
    purchase_date DATE,
    purchase_price NUMERIC(10, 2),
    warranty_until DATE,
    -- Free-text room label; will become FK to a future `rooms` table when the
    -- "Pièces & rangement" module ships (Phase 4 in the roadmap).
    location_room VARCHAR(60),
    image_url TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_house_equipments_user ON house_equipments(user_id);
CREATE INDEX IF NOT EXISTS idx_house_equipments_warranty
    ON house_equipments(user_id, warranty_until)
    WHERE warranty_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS house_maintenance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    equipment_id UUID NOT NULL REFERENCES house_equipments(id) ON DELETE CASCADE,
    title VARCHAR(120) NOT NULL,
    kind VARCHAR(24) NOT NULL,
    -- A row is either purely planned (future), purely historical (logbook
    -- entry), or both (planned then performed). Reject the all-null case so
    -- a row always represents a real action in time.
    planned_date DATE,
    performed_date DATE,
    cost NUMERIC(10, 2),
    -- When set, completing this maintenance triggers the route handler to
    -- INSERT the next planned occurrence at performed_date + N months.
    recurrence_months INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT house_maintenance_dates_present
        CHECK (planned_date IS NOT NULL OR performed_date IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_house_maintenance_equipment
    ON house_maintenance(equipment_id);
CREATE INDEX IF NOT EXISTS idx_house_maintenance_planned
    ON house_maintenance(user_id, planned_date)
    WHERE planned_date IS NOT NULL;

-- updated_at triggers reuse the existing function from the initial schema.
CREATE TRIGGER update_house_equipments_updated_at
    BEFORE UPDATE ON house_equipments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_house_maintenance_updated_at
    BEFORE UPDATE ON house_maintenance
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Down Migration
DROP TRIGGER IF EXISTS update_house_maintenance_updated_at ON house_maintenance;
DROP TRIGGER IF EXISTS update_house_equipments_updated_at ON house_equipments;
DROP INDEX IF EXISTS idx_house_maintenance_planned;
DROP INDEX IF EXISTS idx_house_maintenance_equipment;
DROP TABLE IF EXISTS house_maintenance;
DROP INDEX IF EXISTS idx_house_equipments_warranty;
DROP INDEX IF EXISTS idx_house_equipments_user;
DROP TABLE IF EXISTS house_equipments;
