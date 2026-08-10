-- Up Migration
-- "École" module — revision sheets (fiches de révision).
--
-- A revision sheet is a printable worksheet: one page, one notion, a short
-- focus warm-up and a handful of exercises with their answer key. It is the
-- paper counterpart of school_study_sessions — a session says WHEN the child
-- works, a sheet says WHAT is on the table.
--
-- Deliberately its own table rather than columns on school_study_sessions:
-- a sheet outlives the slot it was printed for (reprint it, redo it later),
-- and most sheets are never scheduled at all.
--
-- Exercises live in JSONB rather than a child table — same call as
-- house_projects.checklist. A sheet has a handful of them, they are always
-- read and written as a whole, and nothing ever queries across them.
-- Shape (owned by schemas/school.ts):
--   [{ prompt, hint?, answer?, answer_lines? }, …]
--
-- Enum-like columns stay free-form VARCHAR (zod owns the enum), matching the
-- rest of the module.

CREATE TABLE IF NOT EXISTS school_revision_sheets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
    -- 'Mathématique', 'Français', 'Anglais', 'Univers social', 'Science',
    -- 'Arts', 'Éducation physique', 'Musique', 'Lecture', 'Autre'
    subject VARCHAR(40) NOT NULL,
    -- The curriculum notion being revised, as the child's reference material
    -- names it ('Les fractions', 'Les homophones a et à'…).
    topic VARCHAR(160),
    -- The playful title printed at the top of the page.
    title VARCHAR(160) NOT NULL,
    -- 'Jeu', 'Défi', 'Énigme', 'Exercice', 'Quiz', 'Projet'
    sheet_type VARCHAR(24) NOT NULL DEFAULT 'Exercice',
    duration_minutes INTEGER NOT NULL DEFAULT 20,
    -- The 2-3 minute ritual printed above the exercises. This is the
    -- "get back into focus after the summer" part of the sheet: it is what the
    -- child does BEFORE picking up a pencil.
    focus_warmup TEXT,
    -- Consigne générale, printed under the title.
    instructions TEXT,
    exercises JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- 'À faire', 'Faite', 'À revoir'
    status VARCHAR(16) NOT NULL DEFAULT 'À faire',
    -- 1..5 self-assessment, same scale as school_study_sessions.mastery.
    mastery INTEGER,
    completed_at TIMESTAMP,
    -- Last time the sheet went to the printer, so a parent preparing a batch
    -- can tell at a glance what is already on paper.
    printed_at TIMESTAMP,
    -- Where the notion is explained (Alloprof page, workbook page…).
    source VARCHAR(300),
    notes TEXT,
    -- Preserves the order of a printed booklet.
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT school_revision_duration CHECK (duration_minutes BETWEEN 5 AND 240),
    CONSTRAINT school_revision_mastery CHECK (mastery IS NULL OR mastery BETWEEN 1 AND 5),
    CONSTRAINT school_revision_exercises CHECK (jsonb_typeof(exercises) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_school_revisions_student
    ON school_revision_sheets(student_id, position);
CREATE INDEX IF NOT EXISTS idx_school_revisions_user ON school_revision_sheets(user_id);

CREATE TRIGGER update_school_revision_sheets_updated_at
    BEFORE UPDATE ON school_revision_sheets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Down Migration
DROP TRIGGER IF EXISTS update_school_revision_sheets_updated_at ON school_revision_sheets;
DROP TABLE IF EXISTS school_revision_sheets;
