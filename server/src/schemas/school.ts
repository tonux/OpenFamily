import { z } from 'zod';

// =============================================================================
// "École" schemas — students, calendar events, supply checklist, at-home study
// sessions and grades.
//
// Same conventions as schemas/garden.ts: zod enums for restricted fields,
// .strict() to reject unknown keys, ISO date strings handed straight to PG,
// PATCH schemas redeclare the shape with .optional() + a non-empty refine.
//
// Enum values are stored in FRENCH (DATA-vs-UI rule) and deliberately avoid
// apostrophes so they stay safe as query-string values; the UI expands them
// (e.g. 'Cahier' renders as « Cahier d'exercices »).
// =============================================================================

export const SCHOOL_EVENT_TYPES = [
    'Rentrée',
    'Pédagogique',
    'Congé',
    'Examen',
    'Devoir',
    'Réunion',
    'Sortie',
    'Photo',
    'Bulletin',
    'Autre',
] as const;
export type SchoolEventType = (typeof SCHOOL_EVENT_TYPES)[number];

export const SCHOOL_SUPPLY_CATEGORIES = [
    'Cahier',
    'Fourniture',
    'Vêtement',
    'Numérique',
    'Frais',
    'Autre',
] as const;
export type SchoolSupplyCategory = (typeof SCHOOL_SUPPLY_CATEGORIES)[number];

export const SCHOOL_SUBJECTS = [
    'Mathématique',
    'Français',
    'Anglais',
    'Univers social',
    'Science',
    'Arts',
    'Éducation physique',
    'Musique',
    'Lecture',
    'Autre',
] as const;
export type SchoolSubject = (typeof SCHOOL_SUBJECTS)[number];

export const SCHOOL_STUDY_STATUSES = ['Planifiée', 'Faite', 'Manquée'] as const;
export type SchoolStudyStatus = (typeof SCHOOL_STUDY_STATUSES)[number];

/** How a revision sheet is framed on paper. Drives the icon and the tone. */
export const SCHOOL_SHEET_TYPES = ['Jeu', 'Défi', 'Énigme', 'Exercice', 'Quiz', 'Projet'] as const;
export type SchoolSheetType = (typeof SCHOOL_SHEET_TYPES)[number];

export const SCHOOL_REVISION_STATUSES = ['À faire', 'Faite', 'À revoir'] as const;
export type SchoolRevisionStatus = (typeof SCHOOL_REVISION_STATUSES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Expected YYYY-MM-DD' });
const isoTime = z.string().regex(/^\d{2}:\d{2}$/, { message: 'Expected HH:MM' });

const optionalNullable = <T extends z.ZodTypeAny>(schema: T) =>
    schema.nullish().transform((v) => (v === undefined ? undefined : v));

const optionalString = (max: number) =>
    optionalNullable(z.string().trim().max(max).or(z.literal('')))
        // Coerce empty strings to null so the DB stays clean.
        .transform((v) => (typeof v === 'string' && v.length === 0 ? null : v));

// ---------- Students ----------

const schoolYear = z
    .string()
    .trim()
    .regex(/^\d{4}-\d{4}$/, { message: 'Expected YYYY-YYYY' });

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'Expected #RRGGBB' });

export const studentBodySchema = z
    .object({
        name: z.string().trim().min(1).max(120),
        school_year: schoolYear,
        family_member_id: z.string().uuid().nullable().optional(),
        school_name: optionalString(160),
        grade_level: optionalString(60),
        teacher_name: optionalString(120),
        class_name: optionalString(60),
        color: hexColor.optional(),
        notes: optionalString(2000),
    })
    .strict();

export const studentPatchSchema = z
    .object({
        name: z.string().trim().min(1).max(120).optional(),
        school_year: schoolYear.optional(),
        family_member_id: z.string().uuid().nullable().optional(),
        school_name: optionalString(160).optional(),
        grade_level: optionalString(60).optional(),
        teacher_name: optionalString(120).optional(),
        class_name: optionalString(60).optional(),
        color: hexColor.optional(),
        notes: optionalString(2000).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const studentListQuerySchema = z
    .object({
        school_year: schoolYear.optional(),
    })
    .strict();

// ---------- Events ----------

const endAfterStart = <T extends { start_date?: unknown; end_date?: unknown }>(v: T) =>
    !v.start_date || !v.end_date || String(v.end_date) >= String(v.start_date);

export const eventBodySchema = z
    .object({
        title: z.string().trim().min(1).max(160),
        event_type: z.enum(SCHOOL_EVENT_TYPES),
        start_date: isoDate,
        end_date: optionalNullable(isoDate),
        start_time: optionalNullable(isoTime),
        student_id: z.string().uuid().nullable().optional(),
        location: optionalString(500),
        notes: optionalString(2000),
        reminder_enabled: z.boolean().optional(),
        reminder_days_before: z.number().int().min(0).max(30).optional(),
    })
    .strict()
    .refine(endAfterStart, {
        message: 'end_date must be on or after start_date',
        path: ['end_date'],
    });

export const eventPatchSchema = z
    .object({
        title: z.string().trim().min(1).max(160).optional(),
        event_type: z.enum(SCHOOL_EVENT_TYPES).optional(),
        start_date: isoDate.optional(),
        end_date: optionalNullable(isoDate).optional(),
        start_time: optionalNullable(isoTime).optional(),
        student_id: z.string().uuid().nullable().optional(),
        location: optionalString(500).optional(),
        notes: optionalString(2000).optional(),
        reminder_enabled: z.boolean().optional(),
        reminder_days_before: z.number().int().min(0).max(30).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })
    .refine(endAfterStart, {
        message: 'end_date must be on or after start_date',
        path: ['end_date'],
    });

export const eventListQuerySchema = z
    .object({
        student_id: z.string().uuid().optional(),
        event_type: z.enum(SCHOOL_EVENT_TYPES).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        // 'upcoming' keeps today's and future events only.
        scope: z.enum(['upcoming', 'all']).optional(),
    })
    .strict();

// ---------- Supplies ----------

export const supplyBodySchema = z
    .object({
        student_id: z.string().uuid(),
        label: z.string().trim().min(1).max(200),
        category: z.enum(SCHOOL_SUPPLY_CATEGORIES),
        quantity: z.number().int().min(1).max(999).optional(),
        isbn: optionalString(32),
        subject: z.enum(SCHOOL_SUBJECTS).nullish(),
        store: optionalString(120),
        unit_price: optionalNullable(z.number().min(0).max(1_000_000)),
        is_purchased: z.boolean().optional(),
        purchased_at: optionalNullable(isoDate),
        notes: optionalString(2000),
        position: z.number().int().min(0).max(10_000).optional(),
    })
    .strict();

export const supplyPatchSchema = z
    .object({
        label: z.string().trim().min(1).max(200).optional(),
        category: z.enum(SCHOOL_SUPPLY_CATEGORIES).optional(),
        quantity: z.number().int().min(1).max(999).optional(),
        isbn: optionalString(32).optional(),
        subject: z.enum(SCHOOL_SUBJECTS).nullish(),
        store: optionalString(120).optional(),
        unit_price: optionalNullable(z.number().min(0).max(1_000_000)).optional(),
        is_purchased: z.boolean().optional(),
        purchased_at: optionalNullable(isoDate).optional(),
        notes: optionalString(2000).optional(),
        position: z.number().int().min(0).max(10_000).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const supplyListQuerySchema = z
    .object({
        student_id: z.string().uuid().optional(),
        category: z.enum(SCHOOL_SUPPLY_CATEGORIES).optional(),
        purchased: z.enum(['true', 'false']).optional(),
        q: z.string().trim().min(1).max(120).optional(),
    })
    .strict();

// ---------- Study sessions ----------

export const studySessionBodySchema = z
    .object({
        student_id: z.string().uuid(),
        subject: z.enum(SCHOOL_SUBJECTS),
        title: z.string().trim().min(1).max(160),
        scheduled_date: isoDate,
        start_time: optionalNullable(isoTime),
        duration_minutes: z.number().int().min(5).max(480).optional(),
        objective: optionalString(2000),
        status: z.enum(SCHOOL_STUDY_STATUSES).optional(),
        mastery: optionalNullable(z.number().int().min(1).max(5)),
        recurrence_days: optionalNullable(z.number().int().min(1).max(365)),
        notes: optionalString(2000),
        reminder_enabled: z.boolean().optional(),
    })
    .strict();

export const studySessionPatchSchema = z
    .object({
        subject: z.enum(SCHOOL_SUBJECTS).optional(),
        title: z.string().trim().min(1).max(160).optional(),
        scheduled_date: isoDate.optional(),
        start_time: optionalNullable(isoTime).optional(),
        duration_minutes: z.number().int().min(5).max(480).optional(),
        objective: optionalString(2000).optional(),
        status: z.enum(SCHOOL_STUDY_STATUSES).optional(),
        mastery: optionalNullable(z.number().int().min(1).max(5)).optional(),
        recurrence_days: optionalNullable(z.number().int().min(1).max(365)).optional(),
        notes: optionalString(2000).optional(),
        reminder_enabled: z.boolean().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const studySessionCompleteSchema = z
    .object({
        mastery: z.number().int().min(1).max(5).optional(),
        notes: optionalString(2000),
    })
    .strict();

export const studySessionListQuerySchema = z
    .object({
        student_id: z.string().uuid().optional(),
        subject: z.enum(SCHOOL_SUBJECTS).optional(),
        status: z.enum([...SCHOOL_STUDY_STATUSES, 'all']).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
    })
    .strict();

/**
 * Weekly-plan generator. Turns a "which subject on which weekday" template into
 * concrete sessions over `weeks` weeks, starting at `start_date`.
 *
 * weekday: 0 = Sunday … 6 = Saturday (JS getDay()), so the client can build the
 * template straight from a Date without a mapping table.
 */
export const studyPlanSchema = z
    .object({
        student_id: z.string().uuid(),
        start_date: isoDate,
        weeks: z.number().int().min(1).max(52),
        // Skip days already declared as school breaks / 'Congé' events.
        skip_breaks: z.boolean().optional(),
        slots: z
            .array(
                z
                    .object({
                        weekday: z.number().int().min(0).max(6),
                        subject: z.enum(SCHOOL_SUBJECTS),
                        title: z.string().trim().min(1).max(160).optional(),
                        start_time: optionalNullable(isoTime),
                        duration_minutes: z.number().int().min(5).max(480).optional(),
                        objective: optionalString(2000),
                    })
                    .strict(),
            )
            .min(1)
            .max(21),
    })
    .strict();

// ---------- Grades ----------

export const gradeBodySchema = z
    .object({
        student_id: z.string().uuid(),
        subject: z.enum(SCHOOL_SUBJECTS),
        title: z.string().trim().min(1).max(160),
        evaluated_on: isoDate,
        score: z.number().min(0).max(10_000),
        max_score: z.number().min(0.01).max(10_000).optional(),
        term: optionalString(24),
        notes: optionalString(2000),
    })
    .strict()
    .refine((v) => v.score <= (v.max_score ?? 100), {
        message: 'score must not exceed max_score',
        path: ['score'],
    });

export const gradePatchSchema = z
    .object({
        subject: z.enum(SCHOOL_SUBJECTS).optional(),
        title: z.string().trim().min(1).max(160).optional(),
        evaluated_on: isoDate.optional(),
        score: z.number().min(0).max(10_000).optional(),
        max_score: z.number().min(0.01).max(10_000).optional(),
        term: optionalString(24).optional(),
        notes: optionalString(2000).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })
    .refine((v) => v.score === undefined || v.max_score === undefined || v.score <= v.max_score, {
        message: 'score must not exceed max_score',
        path: ['score'],
    });

export const gradeListQuerySchema = z
    .object({
        student_id: z.string().uuid().optional(),
        subject: z.enum(SCHOOL_SUBJECTS).optional(),
        term: z.string().trim().min(1).max(24).optional(),
    })
    .strict();

// ---------- Revision sheets ----------

/**
 * One exercise on a printed sheet. `answer` feeds the corrigé page (printed
 * separately so the child never sees it), `answer_lines` is how many blank
 * ruled lines to leave under the question.
 */
export const revisionExerciseSchema = z
    .object({
        prompt: z.string().trim().min(1).max(1000),
        hint: optionalString(300),
        answer: optionalString(1000),
        answer_lines: z.number().int().min(0).max(20).optional(),
    })
    .strict();

const revisionExercises = z.array(revisionExerciseSchema).max(30);

export const revisionSheetBodySchema = z
    .object({
        student_id: z.string().uuid(),
        subject: z.enum(SCHOOL_SUBJECTS),
        topic: optionalString(160),
        title: z.string().trim().min(1).max(160),
        sheet_type: z.enum(SCHOOL_SHEET_TYPES).optional(),
        duration_minutes: z.number().int().min(5).max(240).optional(),
        focus_warmup: optionalString(2000),
        instructions: optionalString(2000),
        exercises: revisionExercises.optional(),
        status: z.enum(SCHOOL_REVISION_STATUSES).optional(),
        mastery: optionalNullable(z.number().int().min(1).max(5)),
        source: optionalString(300),
        notes: optionalString(2000),
        position: z.number().int().min(0).max(10_000).optional(),
    })
    .strict();

export const revisionSheetPatchSchema = z
    .object({
        subject: z.enum(SCHOOL_SUBJECTS).optional(),
        topic: optionalString(160).optional(),
        title: z.string().trim().min(1).max(160).optional(),
        sheet_type: z.enum(SCHOOL_SHEET_TYPES).optional(),
        duration_minutes: z.number().int().min(5).max(240).optional(),
        focus_warmup: optionalString(2000).optional(),
        instructions: optionalString(2000).optional(),
        exercises: revisionExercises.optional(),
        status: z.enum(SCHOOL_REVISION_STATUSES).optional(),
        mastery: optionalNullable(z.number().int().min(1).max(5)).optional(),
        source: optionalString(300).optional(),
        notes: optionalString(2000).optional(),
        position: z.number().int().min(0).max(10_000).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const revisionSheetListQuerySchema = z
    .object({
        student_id: z.string().uuid().optional(),
        subject: z.enum(SCHOOL_SUBJECTS).optional(),
        sheet_type: z.enum(SCHOOL_SHEET_TYPES).optional(),
        status: z.enum([...SCHOOL_REVISION_STATUSES, 'all']).optional(),
        q: z.string().trim().min(1).max(120).optional(),
    })
    .strict();

/** Stamps printed_at on a batch, after the browser's print dialog was opened. */
export const revisionMarkPrintedSchema = z
    .object({
        ids: z.array(z.string().uuid()).min(1).max(200),
    })
    .strict();

/**
 * Import a ready-made revision booklet onto a student. `subjects` narrows the
 * import to a few matières; omitted means everything in the booklet.
 */
export const revisionCatalogApplySchema = z
    .object({
        student_id: z.string().uuid(),
        subjects: z.array(z.enum(SCHOOL_SUBJECTS)).min(1).max(SCHOOL_SUBJECTS.length).optional(),
    })
    .strict();

// ---------- Presets ----------

export const presetApplySchema = z
    .object({
        student_id: z.string().uuid(),
        // Which parts of the preset to import. Defaults to everything.
        include_events: z.boolean().optional(),
        include_supplies: z.boolean().optional(),
    })
    .strict();

export const statisticsQuerySchema = z
    .object({
        student_id: z.string().uuid().optional(),
    })
    .strict();

export type StudentBody = z.infer<typeof studentBodySchema>;
export type StudentPatch = z.infer<typeof studentPatchSchema>;
export type EventBody = z.infer<typeof eventBodySchema>;
export type EventPatch = z.infer<typeof eventPatchSchema>;
export type SupplyBody = z.infer<typeof supplyBodySchema>;
export type SupplyPatch = z.infer<typeof supplyPatchSchema>;
export type StudySessionBody = z.infer<typeof studySessionBodySchema>;
export type StudySessionPatch = z.infer<typeof studySessionPatchSchema>;
export type StudyPlanBody = z.infer<typeof studyPlanSchema>;
export type GradeBody = z.infer<typeof gradeBodySchema>;
export type GradePatch = z.infer<typeof gradePatchSchema>;
export type RevisionExercise = z.infer<typeof revisionExerciseSchema>;
export type RevisionSheetBody = z.infer<typeof revisionSheetBodySchema>;
export type RevisionSheetPatch = z.infer<typeof revisionSheetPatchSchema>;
