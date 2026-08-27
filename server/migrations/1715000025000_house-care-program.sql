-- Up Migration
-- Phase 8 of the "Maison" section: the seasonal care program.
--
-- Why a new set of tables instead of reusing house_maintenance:
--   house_maintenance.equipment_id is NOT NULL — every row hangs off a piece
--   of equipment. But most of what actually protects a house has no equipment
--   behind it: cleaning gutters, checking the foundation after thaw, sealing
--   the driveway, watching for ice dams. Those are *property* care, recurring
--   on a seasonal window rather than a fixed "every N months from the last
--   time", and they need a risk rationale so a first-time owner understands
--   why skipping one is expensive.
--
-- Three tables:
--   house_profile     — one row per user; the facts that make the plan (and
--                       the AI advice) specific to THIS house.
--   house_care_tasks  — the recurring program. Seeded from a curated catalog,
--                       extended by the AI, editable by hand.
--   house_care_logs   — completion history: what was done, when, what was seen.
--
-- Scheduling model: `next_due_on` is denormalised on the task and recomputed
-- by the route on completion (and at seed time). Reads are far more frequent
-- than writes here (every dashboard hit filters on "due"), and the alternative
-- — deriving it from the last log row on every query — turns the weekly
-- checklist into a correlated subquery per task.

CREATE TABLE IF NOT EXISTS house_profile (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- Free-form text in DB; the API enforces the enum via zod so adding a
    -- dwelling type later doesn't require a migration. Same convention as
    -- house_equipments.category.
    dwelling_type VARCHAR(40) NOT NULL DEFAULT 'Unifamiliale',
    build_year INTEGER,
    living_area_m2 NUMERIC(7, 1),
    occupants INTEGER,
    -- Drives which seasonal tasks apply at all: a "Continental humide" plan
    -- carries frost, ice-dam and thaw tasks that a Mediterranean one must not.
    climate_zone VARCHAR(48) NOT NULL DEFAULT 'Continental humide (hivers rigoureux)',
    has_basement BOOLEAN NOT NULL DEFAULT true,
    basement_finished BOOLEAN NOT NULL DEFAULT false,
    has_sump_pump BOOLEAN NOT NULL DEFAULT false,
    has_garage BOOLEAN NOT NULL DEFAULT false,
    has_pool BOOLEAN NOT NULL DEFAULT false,
    has_septic BOOLEAN NOT NULL DEFAULT false,
    has_well BOOLEAN NOT NULL DEFAULT false,
    has_irrigation BOOLEAN NOT NULL DEFAULT false,
    has_air_exchanger BOOLEAN NOT NULL DEFAULT false,
    -- ["Thermopompe", "Poêle à bois"] — a house routinely has two systems and
    -- each one carries its own tasks, so this is a list, not a single value.
    heating_types JSONB NOT NULL DEFAULT '[]'::jsonb,
    roof_type VARCHAR(40),
    -- Install years, not ages: an age would silently rot as time passes. The
    -- "big-ticket forecast" derives remaining life from these.
    roof_year INTEGER,
    water_heater_year INTEGER,
    windows_year INTEGER,
    siding_type VARCHAR(40),
    -- Purchase price / assessed value, used for the "provision 1-3 %/year"
    -- maintenance-budget guidance. Nullable — the feature degrades to a
    -- qualitative hint when it's unknown.
    property_value NUMERIC(12, 2),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS house_care_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(140) NOT NULL,
    -- 'Toiture', 'Extérieur', 'Plomberie', 'Chauffage & ventilation', …
    category VARCHAR(40) NOT NULL,
    -- 'Printemps' | 'Été' | 'Automne' | 'Hiver' | 'Toute l'année'
    season VARCHAR(20) NOT NULL,
    -- 'Hebdomadaire' | 'Mensuel' | 'Trimestriel' | 'Saisonnier' | 'Annuel' | 'Pluriannuel'
    frequency VARCHAR(20) NOT NULL,
    -- Canonical recurrence in months. NULL for weekly tasks (handled by the
    -- weekly checklist, which never "expires" — it just resets).
    interval_months INTEGER,
    -- Ideal calendar window, 1-12 inclusive. Wrapping windows are legal and
    -- expected: winter is month_start=12, month_end=2.
    month_start SMALLINT,
    month_end SMALLINT,
    -- 'Critique' | 'Important' | 'Confort'. Critique = skipping it risks a
    -- five-figure repair or a safety incident.
    priority VARCHAR(16) NOT NULL DEFAULT 'Important',
    -- 'Soi-même' | 'Professionnel' | 'Mixte'
    responsibility VARCHAR(20) NOT NULL DEFAULT 'Soi-même',
    estimated_minutes INTEGER,
    estimated_cost NUMERIC(10, 2),
    -- The whole point of the module for a first-time owner: what it costs you
    -- if you skip this. Shown in the UI next to every Critique task.
    risk_if_skipped TEXT,
    -- ["Sortir l'échelle…", "Vérifier…"] — plain strings, ordered.
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Optional link to an inventoried device (the heat pump, the water heater).
    equipment_id UUID REFERENCES house_equipments(id) ON DELETE SET NULL,
    -- 'catalog' | 'ai' | 'manual' — lets the UI say where a task came from and
    -- lets a re-seed skip what the user already has.
    source VARCHAR(12) NOT NULL DEFAULT 'manual',
    -- Stable identifier from the seeded catalog; NULL for AI/manual tasks.
    catalog_key VARCHAR(60),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_done_on DATE,
    next_due_on DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT house_care_tasks_month_start_range
        CHECK (month_start IS NULL OR (month_start BETWEEN 1 AND 12)),
    CONSTRAINT house_care_tasks_month_end_range
        CHECK (month_end IS NULL OR (month_end BETWEEN 1 AND 12))
);

-- Re-seeding must be idempotent: the catalog is filtered by the profile, and a
-- user who adds a pool then re-seeds should get the pool tasks WITHOUT getting
-- a second copy of everything else. Partial index so manual/AI tasks (NULL key)
-- are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_house_care_tasks_catalog_key
    ON house_care_tasks(user_id, catalog_key)
    WHERE catalog_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_house_care_tasks_user ON house_care_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_house_care_tasks_due
    ON house_care_tasks(user_id, next_due_on)
    WHERE is_active = true AND next_due_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_house_care_tasks_season
    ON house_care_tasks(user_id, season)
    WHERE is_active = true;

CREATE TABLE IF NOT EXISTS house_care_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES house_care_tasks(id) ON DELETE CASCADE,
    done_on DATE NOT NULL DEFAULT CURRENT_DATE,
    -- 'Fait' | 'Ignoré' | 'Problème'. 'Problème' is the interesting one: it
    -- feeds the AI briefing ("tu as noté une trace d'eau au sous-sol en mars").
    status VARCHAR(16) NOT NULL DEFAULT 'Fait',
    minutes_spent INTEGER,
    cost NUMERIC(10, 2),
    observation TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_house_care_logs_task ON house_care_logs(task_id, done_on DESC);
CREATE INDEX IF NOT EXISTS idx_house_care_logs_user ON house_care_logs(user_id, done_on DESC);

CREATE TRIGGER update_house_profile_updated_at
    BEFORE UPDATE ON house_profile
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_house_care_tasks_updated_at
    BEFORE UPDATE ON house_care_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Down Migration
DROP TRIGGER IF EXISTS update_house_care_tasks_updated_at ON house_care_tasks;
DROP TRIGGER IF EXISTS update_house_profile_updated_at ON house_profile;
DROP INDEX IF EXISTS idx_house_care_logs_user;
DROP INDEX IF EXISTS idx_house_care_logs_task;
DROP TABLE IF EXISTS house_care_logs;
DROP INDEX IF EXISTS idx_house_care_tasks_season;
DROP INDEX IF EXISTS idx_house_care_tasks_due;
DROP INDEX IF EXISTS idx_house_care_tasks_user;
DROP INDEX IF EXISTS idx_house_care_tasks_catalog_key;
DROP TABLE IF EXISTS house_care_tasks;
DROP TABLE IF EXISTS house_profile;
