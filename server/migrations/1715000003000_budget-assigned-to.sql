-- Up Migration
-- Lets a budget entry be attributed to a specific family member.

ALTER TABLE budget_entries
    ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES family_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_budget_entries_assigned_to
    ON budget_entries(assigned_to);

-- Down Migration
DROP INDEX IF EXISTS idx_budget_entries_assigned_to;
ALTER TABLE budget_entries DROP COLUMN IF EXISTS assigned_to;
