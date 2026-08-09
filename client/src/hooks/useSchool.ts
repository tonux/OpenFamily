import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryClient';

// =============================================================================
// "École" data hooks.
// Same shape as useGarden: enum constants + <Type> interfaces → useXxx queries →
// useCreate / useUpdate / useDelete mutations that invalidate the right keys.
//
// Enum values are STORED IN FRENCH (DATA-vs-UI rule) and mirror
// server/src/schemas/school.ts. They are duplicated here rather than imported
// from @keurtonux/shared because that workspace isn't wired into the client
// bundle — same convention as useGarden.ts.
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

/**
 * Which event types mean "no class today". Used by the calendar to grey out the
 * day and by the planner to explain why a slot was skipped.
 */
export const NO_CLASS_EVENT_TYPES: readonly SchoolEventType[] = ['Congé', 'Pédagogique'];

// ---------- Entity types ----------

export interface SchoolStudent {
    id: string;
    family_member_id?: string | null;
    name: string;
    school_name?: string | null;
    grade_level?: string | null;
    school_year: string;
    teacher_name?: string | null;
    class_name?: string | null;
    color: string;
    notes?: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface SchoolEvent {
    id: string;
    student_id?: string | null;
    student_name?: string | null;
    title: string;
    event_type: SchoolEventType;
    start_date: string;
    end_date?: string | null;
    start_time?: string | null;
    location?: string | null;
    notes?: string | null;
    reminder_enabled: boolean;
    reminder_days_before: number;
    created_at?: string;
    updated_at?: string;
}

export interface SchoolSupply {
    id: string;
    student_id: string;
    label: string;
    category: SchoolSupplyCategory;
    quantity: number;
    isbn?: string | null;
    subject?: SchoolSubject | null;
    store?: string | null;
    unit_price?: number | null;
    is_purchased: boolean;
    purchased_at?: string | null;
    notes?: string | null;
    position: number;
    created_at?: string;
    updated_at?: string;
}

export interface SchoolStudySession {
    id: string;
    student_id: string;
    subject: SchoolSubject;
    title: string;
    scheduled_date: string;
    start_time?: string | null;
    duration_minutes: number;
    objective?: string | null;
    status: SchoolStudyStatus;
    completed_at?: string | null;
    mastery?: number | null;
    recurrence_days?: number | null;
    notes?: string | null;
    reminder_enabled: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface SchoolGrade {
    id: string;
    student_id: string;
    subject: SchoolSubject;
    title: string;
    evaluated_on: string;
    score: number;
    max_score: number;
    /** Server-computed score/max_score as a percentage, rounded to 0.1. */
    percentage: number;
    term?: string | null;
    notes?: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface SchoolSubjectInsight {
    subject: SchoolSubject;
    avg_percentage: number | null;
    grades_count: number;
    last_evaluated_on: string | null;
    minutes_done: number;
    sessions_done: number;
    sessions_planned: number;
    avg_mastery: number | null;
}

export interface SchoolStatistics {
    upcoming_events: SchoolEvent[];
    upcoming_sessions: SchoolStudySession[];
    counts: {
        supplies_total: number;
        supplies_purchased: number;
        supplies_cost: number;
        events_next_7d: number;
        sessions_today: number;
        sessions_late: number;
        minutes_done_7d: number;
    };
    by_subject: SchoolSubjectInsight[];
}

export interface SchoolPreset {
    id: string;
    label: string;
    description: string;
    school_year: string;
    grade_level: string;
    school_name: string;
    caveat: string;
    events_count: number;
    supplies_count: number;
}

export interface PresetApplyResult {
    preset_id: string;
    events_created: number;
    events_skipped: number;
    supplies_created: number;
    supplies_skipped: number;
    caveat: string;
}

// ---------- Queries ----------

const toQuery = (filters?: Record<string, string | undefined>): string => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters ?? {})) {
        if (v) params.set(k, v);
    }
    const suffix = params.toString();
    return suffix ? `?${suffix}` : '';
};

export const useSchoolStudents = (filters?: { school_year?: string }) =>
    useQuery({
        queryKey: queryKeys.school.students(filters),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: SchoolStudent[] }>(
                `/api/school/students${toQuery(filters)}`,
            );
            return r.data;
        },
    });

export const useSchoolEvents = (filters?: {
    student_id?: string;
    event_type?: SchoolEventType;
    from?: string;
    to?: string;
    scope?: 'upcoming' | 'all';
}) =>
    useQuery({
        queryKey: queryKeys.school.events(filters),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: SchoolEvent[] }>(
                `/api/school/events${toQuery(filters)}`,
            );
            return r.data;
        },
    });

export const useSchoolSupplies = (filters?: {
    student_id?: string;
    category?: SchoolSupplyCategory;
    purchased?: 'true' | 'false';
    q?: string;
}) =>
    useQuery({
        queryKey: queryKeys.school.supplies(filters),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: SchoolSupply[] }>(
                `/api/school/supplies${toQuery(filters)}`,
            );
            return r.data;
        },
    });

export const useSchoolStudySessions = (filters?: {
    student_id?: string;
    subject?: SchoolSubject;
    status?: SchoolStudyStatus | 'all';
    from?: string;
    to?: string;
}) =>
    useQuery({
        queryKey: queryKeys.school.studySessions(filters),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: SchoolStudySession[] }>(
                `/api/school/study-sessions${toQuery(filters)}`,
            );
            return r.data;
        },
    });

export const useSchoolGrades = (filters?: {
    student_id?: string;
    subject?: SchoolSubject;
    term?: string;
}) =>
    useQuery({
        queryKey: queryKeys.school.grades(filters),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: SchoolGrade[] }>(
                `/api/school/grades${toQuery(filters)}`,
            );
            return r.data;
        },
    });

export const useSchoolStatistics = (studentId?: string) =>
    useQuery({
        queryKey: queryKeys.school.statistics(studentId),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: SchoolStatistics }>(
                `/api/school/statistics${toQuery({ student_id: studentId })}`,
            );
            return r.data;
        },
        staleTime: 60_000,
    });

export const useSchoolPresets = () =>
    useQuery({
        queryKey: queryKeys.school.presets(),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: SchoolPreset[] }>(
                '/api/school/presets',
            );
            return r.data;
        },
        // Presets are shipped in the bundle, not user data — no need to refetch.
        staleTime: Infinity,
    });

// ---------- Mutations ----------

const invalidateSchool = (qc: ReturnType<typeof useQueryClient>) => {
    qc.invalidateQueries({ queryKey: queryKeys.school.all });
    qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
};

// Students

export type StudentInput = {
    name: string;
    school_year: string;
    family_member_id?: string | null;
    school_name?: string | null;
    grade_level?: string | null;
    teacher_name?: string | null;
    class_name?: string | null;
    color?: string;
    notes?: string | null;
};

export const useCreateSchoolStudent = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: StudentInput) => {
            const r = await api.post<{ success: boolean; data: SchoolStudent }>(
                '/api/school/students',
                body,
            );
            return r.data;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

export const useUpdateSchoolStudent = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, patch }: { id: string; patch: Partial<StudentInput> }) => {
            const r = await api.patch<{ success: boolean; data: SchoolStudent }>(
                `/api/school/students/${id}`,
                patch,
            );
            return r.data;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

export const useDeleteSchoolStudent = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/school/students/${id}`);
            return id;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

// Events

export type EventInput = {
    title: string;
    event_type: SchoolEventType;
    start_date: string;
    end_date?: string | null;
    start_time?: string | null;
    student_id?: string | null;
    location?: string | null;
    notes?: string | null;
    reminder_enabled?: boolean;
    reminder_days_before?: number;
};

export const useCreateSchoolEvent = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: EventInput) => {
            const r = await api.post<{ success: boolean; data: SchoolEvent }>(
                '/api/school/events',
                body,
            );
            return r.data;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

export const useUpdateSchoolEvent = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, patch }: { id: string; patch: Partial<EventInput> }) => {
            const r = await api.patch<{ success: boolean; data: SchoolEvent }>(
                `/api/school/events/${id}`,
                patch,
            );
            return r.data;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

export const useDeleteSchoolEvent = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/school/events/${id}`);
            return id;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

// Supplies

export type SupplyInput = {
    student_id: string;
    label: string;
    category: SchoolSupplyCategory;
    quantity?: number;
    isbn?: string | null;
    subject?: SchoolSubject | null;
    store?: string | null;
    unit_price?: number | null;
    is_purchased?: boolean;
    purchased_at?: string | null;
    notes?: string | null;
};

export const useCreateSchoolSupply = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: SupplyInput) => {
            const r = await api.post<{ success: boolean; data: SchoolSupply }>(
                '/api/school/supplies',
                body,
            );
            return r.data;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

export const useUpdateSchoolSupply = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            id,
            patch,
        }: {
            id: string;
            patch: Partial<Omit<SupplyInput, 'student_id'>>;
        }) => {
            const r = await api.patch<{ success: boolean; data: SchoolSupply }>(
                `/api/school/supplies/${id}`,
                patch,
            );
            return r.data;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

export const useDeleteSchoolSupply = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/school/supplies/${id}`);
            return id;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

// Study sessions

export type StudySessionInput = {
    student_id: string;
    subject: SchoolSubject;
    title: string;
    scheduled_date: string;
    start_time?: string | null;
    duration_minutes?: number;
    objective?: string | null;
    status?: SchoolStudyStatus;
    mastery?: number | null;
    recurrence_days?: number | null;
    notes?: string | null;
    reminder_enabled?: boolean;
};

export const useCreateStudySession = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: StudySessionInput) => {
            const r = await api.post<{ success: boolean; data: SchoolStudySession }>(
                '/api/school/study-sessions',
                body,
            );
            return r.data;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

export const useUpdateStudySession = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            id,
            patch,
        }: {
            id: string;
            patch: Partial<Omit<StudySessionInput, 'student_id'>>;
        }) => {
            const r = await api.patch<{ success: boolean; data: SchoolStudySession }>(
                `/api/school/study-sessions/${id}`,
                patch,
            );
            return r.data;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

// Marks a session done. When recurrence_days is set the server auto-creates the
// next occurrence and returns it as `next_occurrence`.
export const useCompleteStudySession = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            id,
            mastery,
            notes,
        }: {
            id: string;
            mastery?: number;
            notes?: string;
        }) => {
            const r = await api.patch<{
                success: boolean;
                data: SchoolStudySession & { next_occurrence: SchoolStudySession | null };
            }>(`/api/school/study-sessions/${id}/complete`, {
                ...(mastery ? { mastery } : {}),
                ...(notes ? { notes } : {}),
            });
            return r.data;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

export const useDeleteStudySession = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/school/study-sessions/${id}`);
            return id;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

export interface StudyPlanSlot {
    /** 0 = Sunday … 6 = Saturday, matching Date#getDay(). */
    weekday: number;
    subject: SchoolSubject;
    title?: string;
    start_time?: string | null;
    duration_minutes?: number;
    objective?: string | null;
}

export interface StudyPlanResult {
    created: number;
    skipped_days: number;
    sessions: SchoolStudySession[];
}

/** Expands a weekly template into concrete sessions over N weeks. */
export const useGenerateStudyPlan = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: {
            student_id: string;
            start_date: string;
            weeks: number;
            skip_breaks?: boolean;
            slots: StudyPlanSlot[];
        }) => {
            const r = await api.post<{ success: boolean; data: StudyPlanResult }>(
                '/api/school/study-sessions/plan',
                body,
            );
            return r.data;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

// Grades

export type GradeInput = {
    student_id: string;
    subject: SchoolSubject;
    title: string;
    evaluated_on: string;
    score: number;
    max_score?: number;
    term?: string | null;
    notes?: string | null;
};

export const useCreateSchoolGrade = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: GradeInput) => {
            const r = await api.post<{ success: boolean; data: SchoolGrade }>(
                '/api/school/grades',
                body,
            );
            return r.data;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

export const useDeleteSchoolGrade = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/school/grades/${id}`);
            return id;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};

// Presets

export const useApplySchoolPreset = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            presetId,
            student_id,
            include_events,
            include_supplies,
        }: {
            presetId: string;
            student_id: string;
            include_events?: boolean;
            include_supplies?: boolean;
        }) => {
            const r = await api.post<{ success: boolean; data: PresetApplyResult }>(
                `/api/school/presets/${presetId}/apply`,
                {
                    student_id,
                    ...(include_events !== undefined ? { include_events } : {}),
                    ...(include_supplies !== undefined ? { include_supplies } : {}),
                },
            );
            return r.data;
        },
        onSuccess: () => invalidateSchool(qc),
    });
};
