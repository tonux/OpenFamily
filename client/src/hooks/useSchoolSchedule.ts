import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryClient';

// =============================================================================
// The student's usual weekly timetable.
//
// There is no school-specific table behind this, and there should not be: a
// recurring weekly slot is exactly what `schedule_entries` already models
// (member, weekday 1-7, start/end, location, notes) and what /api/planning
// already exposes, overlap checks included. A second table would mean the same
// hour could say two different things depending on which page you opened.
//
// So the École tab is a *view* over the family planning, narrowed to
// schedule_type='school' and to the family member the student is linked to.
// An entry created here shows up in Planning, and vice versa — which is the
// point. The same reasoning as useScheduleActivity.ts.
// =============================================================================

/** Monday-first, matching schedule_entries.day_of_week (ISO: 1 = Mon … 7 = Sun). */
export const SCHOOL_WEEK_DAYS = [1, 2, 3, 4, 5] as const;
export const ALL_WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface ScheduleEntry {
    id: string;
    family_member_id: string;
    family_member_name?: string;
    family_member_color?: string;
    schedule_type: string;
    title: string;
    day_of_week: number;
    /** 'HH:MM:SS' as Postgres returns TIME. */
    start_time: string;
    end_time: string;
    /** Non-null means a one-off, not part of the usual week. */
    specific_date: string | null;
    location: string | null;
    notes: string | null;
}

export interface ScheduleBulkResult {
    entries: ScheduleEntry[];
    created: number;
    updated: number;
    conflicts: Array<{ day_of_week: number; conflict_ids: string[] }>;
}

export interface ScheduleSlotInput {
    family_member_id: string;
    title: string;
    day_of_week_list: number[];
    start_time: string;
    end_time: string;
    location?: string | null;
    notes?: string | null;
    /** Overwrite whatever already occupies those hours instead of reporting a clash. */
    replace_conflicts?: boolean;
    /** Set when editing: the row the edit started from, so it is updated rather than duplicated. */
    source_entry_id?: string | null;
}

/**
 * The usual week for one student.
 *
 * One-off entries (`specific_date` set) are filtered out: this tab answers
 * "what does a normal Tuesday look like", and a single outing three weeks from
 * now would misrepresent that. Those stay visible in Planning and in the
 * École calendar, where a date actually means something.
 */
export const useSchoolSchedule = (memberId?: string | null) =>
    useQuery({
        queryKey: queryKeys.planning.entries({
            member_id: memberId ?? undefined,
            schedule_type: 'school',
        }),
        enabled: Boolean(memberId),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: ScheduleEntry[] }>(
                `/api/planning?member_id=${encodeURIComponent(memberId!)}&schedule_type=school`,
            );
            return r.data.filter((entry) => !entry.specific_date);
        },
    });

/** Invalidate everything a schedule write can affect, planning page included. */
const useScheduleInvalidation = () => {
    const queryClient = useQueryClient();
    return () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.planning.all });
        // A school slot is a busy hour: the dashboard's day view and activity
        // suggestions both read from it.
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    };
};

/**
 * Create (or move) one slot across several days at once.
 *
 * Goes through POST /api/planning/bulk rather than looping: the same title on
 * Monday, Tuesday, Thursday and Friday is one action from the user's point of
 * view, and the bulk route makes it one transaction — so a clash on Thursday
 * cannot leave Monday and Tuesday half-written.
 */
export const useSaveSchoolScheduleSlot = () => {
    const invalidate = useScheduleInvalidation();

    return useMutation({
        mutationFn: async (input: ScheduleSlotInput) => {
            const r = await api.post<{ success: boolean; data: ScheduleBulkResult }>(
                '/api/planning/bulk',
                {
                    family_member_id: input.family_member_id,
                    schedule_type: 'school',
                    title: input.title,
                    day_of_week_list: input.day_of_week_list,
                    start_time: input.start_time,
                    end_time: input.end_time,
                    location: input.location ?? null,
                    notes: input.notes ?? null,
                    replace_conflicts: input.replace_conflicts ?? false,
                    source_entry_id: input.source_entry_id ?? null,
                },
            );
            return r.data;
        },
        onSuccess: invalidate,
    });
};

export const useDeleteScheduleEntry = () => {
    const invalidate = useScheduleInvalidation();

    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/api/planning/${id}`);
            return id;
        },
        onSuccess: invalidate,
    });
};

/** 'HH:MM:SS' → 'HH:MM'. The seconds Postgres returns are never meaningful here. */
export const toClock = (time: string): string => time.slice(0, 5);

export const timeToMinutes = (time: string): number => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
};
