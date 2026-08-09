-- Up Migration
-- "École" module: follow one child's schooling across a school year.
--
-- Five tables, all user_id-scoped like every other module:
--   school_students       — the child's school profile for a given school year
--   school_events         — the school calendar (rentrée, journées pédagogiques,
--                           congés, examens, réunions…) with per-event reminders
--   school_supplies       — the back-to-school shopping checklist (workbooks
--                           with their ISBN + the school-supply list)
--   school_study_sessions — the at-home study plan (subject, slot, duration)
--   school_grades         — evaluations, so the study plan can target the
--                           subjects that actually need work
--
-- Conventions mirror the house_*/garden_* modules: free-form VARCHAR for
-- enum-like columns (zod owns the enum, so adding a value never needs a
-- migration), ON DELETE CASCADE from users, and the shared
-- update_updated_at_column trigger from the initial schema.
--
-- Reminder policy (school_events, school_study_sessions): rows carry
-- reminder_enabled + reminder_days_before. The daily 08:00 morning pulse
-- (lib/notificationsScheduler.ts) inserts a notification when
-- `date - reminder_days_before = CURRENT_DATE`, which the email worker then
-- turns into an email. Default 1 = "the day before".
--
-- Recurrence policy (school_study_sessions): same shape as garden_care but in
-- DAYS (7 = weekly). Completing a session with recurrence_days set inserts the
-- next occurrence at scheduled_date + N days.

CREATE TABLE IF NOT EXISTS school_students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Optional link to the family module. The school profile outlives the
    -- family member row, so this is SET NULL rather than CASCADE.
    family_member_id UUID REFERENCES family_members(id) ON DELETE SET NULL,
    name VARCHAR(120) NOT NULL,
    school_name VARCHAR(160),
    -- Free text on purpose: grade naming differs per country ('4e année',
    -- 'CM1', 'Grade 4'…).
    grade_level VARCHAR(60),
    -- '2026-2027'
    school_year VARCHAR(16) NOT NULL,
    teacher_name VARCHAR(120),
    class_name VARCHAR(60),
    color VARCHAR(7) NOT NULL DEFAULT '#3B82F6',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_school_students_user ON school_students(user_id);

CREATE TABLE IF NOT EXISTS school_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- NULL = school-wide event that isn't tied to one child.
    student_id UUID REFERENCES school_students(id) ON DELETE CASCADE,
    title VARCHAR(160) NOT NULL,
    -- 'Rentrée', 'Pédagogique', 'Congé', 'Examen', 'Devoir', 'Réunion',
    -- 'Sortie', 'Photo', 'Bulletin', 'Autre'
    event_type VARCHAR(32) NOT NULL,
    start_date DATE NOT NULL,
    -- Inclusive. NULL = single-day event.
    end_date DATE,
    -- NULL = all-day event.
    start_time TIME,
    location TEXT,
    notes TEXT,
    reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    reminder_days_before INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT school_events_range CHECK (end_date IS NULL OR end_date >= start_date),
    CONSTRAINT school_events_reminder_lead CHECK (reminder_days_before BETWEEN 0 AND 30)
);

CREATE INDEX IF NOT EXISTS idx_school_events_user_date
    ON school_events(user_id, start_date);
CREATE INDEX IF NOT EXISTS idx_school_events_student ON school_events(student_id)
    WHERE student_id IS NOT NULL;
-- Supports the morning pulse, which scans only reminder-enabled future events.
CREATE INDEX IF NOT EXISTS idx_school_events_reminder
    ON school_events(start_date)
    WHERE reminder_enabled = TRUE;

CREATE TABLE IF NOT EXISTS school_supplies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
    -- 'Cahier' (workbook, has an ISBN), 'Fourniture', 'Vêtement', 'Numérique',
    -- 'Frais', 'Autre'
    category VARCHAR(32) NOT NULL,
    label VARCHAR(200) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    isbn VARCHAR(32),
    -- Which subject a workbook belongs to; NULL for generic supplies.
    subject VARCHAR(40),
    store VARCHAR(120),
    unit_price NUMERIC(10, 2),
    is_purchased BOOLEAN NOT NULL DEFAULT FALSE,
    purchased_at DATE,
    notes TEXT,
    -- Preserves the order of the school's printed list.
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT school_supplies_quantity CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_school_supplies_student
    ON school_supplies(student_id, position);
CREATE INDEX IF NOT EXISTS idx_school_supplies_user ON school_supplies(user_id);

CREATE TABLE IF NOT EXISTS school_study_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
    -- 'Mathématique', 'Français', 'Anglais', 'Univers social', 'Science',
    -- 'Arts', 'Éducation physique', 'Musique', 'Lecture', 'Autre'
    subject VARCHAR(40) NOT NULL,
    title VARCHAR(160) NOT NULL,
    scheduled_date DATE NOT NULL,
    start_time TIME,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    -- What the session is meant to achieve — the "aider à faire mieux" part.
    objective TEXT,
    -- 'Planifiée', 'Faite', 'Manquée'
    status VARCHAR(16) NOT NULL DEFAULT 'Planifiée',
    completed_at TIMESTAMP,
    -- 1..5 self-assessment captured when the session is marked done. Feeds the
    -- per-subject progress view.
    mastery INTEGER,
    -- 7 = weekly. Completing the session inserts the next occurrence.
    recurrence_days INTEGER,
    notes TEXT,
    reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT school_study_duration CHECK (duration_minutes BETWEEN 5 AND 480),
    CONSTRAINT school_study_mastery CHECK (mastery IS NULL OR mastery BETWEEN 1 AND 5),
    CONSTRAINT school_study_recurrence CHECK (recurrence_days IS NULL OR recurrence_days BETWEEN 1 AND 365)
);

CREATE INDEX IF NOT EXISTS idx_school_study_student_date
    ON school_study_sessions(student_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_school_study_user ON school_study_sessions(user_id);
-- Supports the morning pulse, which only looks at sessions still to be done.
CREATE INDEX IF NOT EXISTS idx_school_study_pending
    ON school_study_sessions(scheduled_date)
    WHERE status = 'Planifiée';

CREATE TABLE IF NOT EXISTS school_grades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
    subject VARCHAR(40) NOT NULL,
    title VARCHAR(160) NOT NULL,
    evaluated_on DATE NOT NULL,
    score NUMERIC(6, 2) NOT NULL,
    -- Kept per-row rather than fixed at 100: schools mix /10, /20 and /100.
    max_score NUMERIC(6, 2) NOT NULL DEFAULT 100,
    -- Free text: 'Étape 1', 'Trimestre 2', …
    term VARCHAR(24),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT school_grades_max CHECK (max_score > 0),
    CONSTRAINT school_grades_score CHECK (score >= 0 AND score <= max_score)
);

CREATE INDEX IF NOT EXISTS idx_school_grades_student
    ON school_grades(student_id, evaluated_on DESC);
CREATE INDEX IF NOT EXISTS idx_school_grades_user ON school_grades(user_id);

-- updated_at triggers reuse the existing function from the initial schema.
CREATE TRIGGER update_school_students_updated_at
    BEFORE UPDATE ON school_students
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_school_events_updated_at
    BEFORE UPDATE ON school_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_school_supplies_updated_at
    BEFORE UPDATE ON school_supplies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_school_study_sessions_updated_at
    BEFORE UPDATE ON school_study_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_school_grades_updated_at
    BEFORE UPDATE ON school_grades
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Down Migration
DROP TRIGGER IF EXISTS update_school_grades_updated_at ON school_grades;
DROP TRIGGER IF EXISTS update_school_study_sessions_updated_at ON school_study_sessions;
DROP TRIGGER IF EXISTS update_school_supplies_updated_at ON school_supplies;
DROP TRIGGER IF EXISTS update_school_events_updated_at ON school_events;
DROP TRIGGER IF EXISTS update_school_students_updated_at ON school_students;
DROP TABLE IF EXISTS school_grades;
DROP TABLE IF EXISTS school_study_sessions;
DROP TABLE IF EXISTS school_supplies;
DROP TABLE IF EXISTS school_events;
DROP TABLE IF EXISTS school_students;
