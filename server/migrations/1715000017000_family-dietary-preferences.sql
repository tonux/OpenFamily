-- Up Migration
-- Per-member dietary preferences used by the AI recipe generator (and reused
-- by future AI features touching food: weekly meal plan, smart shopping…).
--
-- Stored as JSONB to stay schemaless: the shape is owned by the shared types
-- (DietaryPreferences) but the DB doesn't enforce keys, so we can iterate
-- without a migration each time we add a field. Default '{}' keeps existing
-- rows valid and the code can always read with a safe fallback.
--
-- Expected (non-enforced) shape:
--   {
--     "regime": "omnivore" | "vegetarian" | "vegan" | "halal" | "kosher" | "no_pork",
--     "dislikes": string[],          -- ingredients/dishes to avoid
--     "favorites": string[],         -- preferred dishes/cuisines
--     "spice_level": "none" | "mild" | "medium" | "hot",
--     "notes": string                -- free-form
--   }
ALTER TABLE family_members
    ADD COLUMN IF NOT EXISTS dietary_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Down Migration
ALTER TABLE family_members DROP COLUMN IF EXISTS dietary_preferences;
