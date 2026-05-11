-- Up Migration
-- Lunchbox tracking: each kid can have their own lunchbox slot per day, with
-- structured components (main / fruit / snack / drink). We keep a single
-- meal_plans table and discriminate by meal_type = 'Boîte à lunch' + a
-- non-null family_member_id.

ALTER TABLE meal_plans
    ADD COLUMN IF NOT EXISTS family_member_id UUID REFERENCES family_members(id) ON DELETE CASCADE;

ALTER TABLE meal_plans
    ADD COLUMN IF NOT EXISTS lunchbox_items JSONB;

-- The original UNIQUE(user_id, date, meal_type) prevented two rows for the
-- same household-level slot. With lunchboxes we need MULTIPLE rows per
-- (user_id, date, meal_type='Boîte à lunch') — one per kid. Replace the
-- single constraint with two partial uniques:
--   - household meals (family_member_id IS NULL): one per slot
--   - lunchbox meals (family_member_id NOT NULL): one per kid per slot
ALTER TABLE meal_plans
    DROP CONSTRAINT IF EXISTS meal_plans_user_id_date_meal_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_uniq_household
    ON meal_plans (user_id, date, meal_type)
    WHERE family_member_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_uniq_per_member
    ON meal_plans (user_id, date, meal_type, family_member_id)
    WHERE family_member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meal_plans_family_member ON meal_plans (family_member_id);

-- Down Migration
DROP INDEX IF EXISTS idx_meal_plans_family_member;
DROP INDEX IF EXISTS meal_plans_uniq_per_member;
DROP INDEX IF EXISTS meal_plans_uniq_household;
ALTER TABLE meal_plans
    ADD CONSTRAINT meal_plans_user_id_date_meal_type_key UNIQUE (user_id, date, meal_type);
ALTER TABLE meal_plans DROP COLUMN IF EXISTS lunchbox_items;
ALTER TABLE meal_plans DROP COLUMN IF EXISTS family_member_id;
