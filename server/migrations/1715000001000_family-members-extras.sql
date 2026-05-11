-- Up Migration
-- Adds role + emergency contact details + notes to family_members and
-- migrates the legacy single-text columns to the new ones.
-- Idempotent so it can run on already-migrated installations.

ALTER TABLE family_members
    ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'Autre';

ALTER TABLE family_members
    ADD COLUMN IF NOT EXISTS medications TEXT;

ALTER TABLE family_members
    ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;

ALTER TABLE family_members
    ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

ALTER TABLE family_members
    ADD COLUMN IF NOT EXISTS notes TEXT;

-- Backfill from legacy columns when the new ones are empty (re-runs are no-ops).
UPDATE family_members
   SET notes = medical_notes
 WHERE notes IS NULL AND medical_notes IS NOT NULL;

UPDATE family_members
   SET medications = vaccines
 WHERE medications IS NULL AND vaccines IS NOT NULL;

-- Down Migration
ALTER TABLE family_members DROP COLUMN IF EXISTS notes;
ALTER TABLE family_members DROP COLUMN IF EXISTS emergency_contact_phone;
ALTER TABLE family_members DROP COLUMN IF EXISTS emergency_contact_name;
ALTER TABLE family_members DROP COLUMN IF EXISTS medications;
ALTER TABLE family_members DROP COLUMN IF EXISTS role;
