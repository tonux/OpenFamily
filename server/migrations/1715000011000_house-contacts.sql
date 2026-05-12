-- Up Migration
-- Phase 3 of the "Maison" section: trusted-pro address book. Designed to be
-- a flat, fast lookup for "who do I call when the boiler dies" — small per
-- foyer (rarely > 30 rows), so no extra indexes beyond the per-user one.
-- Optional `equipment_id` lets a contact be associated with the equipment
-- they service (e.g. the chauffagiste linked to the chaudière); both sides
-- nullable so contacts and equipments stay independent.

CREATE TABLE IF NOT EXISTS house_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    -- Free-form text in DB; the API enforces the enum.
    category VARCHAR(32) NOT NULL,
    company VARCHAR(120),
    phone VARCHAR(40),
    email VARCHAR(255),
    address TEXT,
    notes TEXT,
    last_intervention_date DATE,
    -- Marks the favourite contact for a category (e.g. "the" plumber). No
    -- DB-enforced unicity — the UI signals when two are flagged so the user
    -- can clean up; cheap and avoids lock contention on rotation.
    is_favorite BOOLEAN NOT NULL DEFAULT false,
    -- Optional link to one equipment this contact services. Set NULL on
    -- equipment delete so the contact survives.
    equipment_id UUID REFERENCES house_equipments(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_house_contacts_user ON house_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_house_contacts_equipment
    ON house_contacts(equipment_id) WHERE equipment_id IS NOT NULL;

CREATE TRIGGER update_house_contacts_updated_at
    BEFORE UPDATE ON house_contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Down Migration
DROP TRIGGER IF EXISTS update_house_contacts_updated_at ON house_contacts;
DROP INDEX IF EXISTS idx_house_contacts_equipment;
DROP INDEX IF EXISTS idx_house_contacts_user;
DROP TABLE IF EXISTS house_contacts;
