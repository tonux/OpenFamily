import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryClient';
import type { ActivityTimeOfDay, KidActivityDTO } from './useKidsActivities';

// =============================================================================
// Turn a suggested activity into a real entry in the family planning.
//
// Reuses POST /api/planning as-is rather than adding an endpoint: schedule
// entries already carry everything an activity needs (member, title, day,
// start/end, a one-off `specific_date`, notes) — and, usefully, the route
// rejects overlapping entries with a 409. So "plan the treasure hunt at 10:00"
// simply cannot land on top of swimming; the caller surfaces the clash.
//
// `schedule_entries.family_member_id` is single-valued, so an activity shared
// by two kids becomes two entries. That's honest: each kid's planning shows it.
// =============================================================================

/** Where each slot starts when the model didn't give us a clock time. */
const SLOT_START: Record<ActivityTimeOfDay, string> = {
    morning: '10:00',
    afternoon: '15:00',
    evening: '17:30',
};

const addMinutes = (hhmm: string, minutes: number): string => {
    const [h, m] = hhmm.split(':').map(Number);
    const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** schedule_entries.day_of_week is ISO: 1 = Monday … 7 = Sunday. */
const isoDayOfWeek = (dateKey: string): number => {
    const js = new Date(`${dateKey}T00:00:00`).getDay(); // 0 = Sunday
    return js === 0 ? 7 : js;
};

export class ActivityConflictError extends Error {
    constructor() {
        super('TIME_OVERLAP');
        this.name = 'ActivityConflictError';
    }
}

export interface ScheduleActivityInput {
    activity: KidActivityDTO;
    /** YYYY-MM-DD — the day the dashboard is talking about. */
    dateKey: string;
}

export const useScheduleActivity = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ activity, dateKey }: ScheduleActivityInput) => {
            const startTime = SLOT_START[activity.timeOfDay];
            const endTime = addMinutes(startTime, activity.durationMinutes);

            for (const kidId of activity.kidIds) {
                try {
                    await api.post('/api/planning', {
                        family_member_id: kidId,
                        schedule_type: 'activity',
                        title: activity.title,
                        day_of_week: isoDayOfWeek(dateKey),
                        start_time: startTime,
                        end_time: endTime,
                        // Without this the entry would recur EVERY week — a
                        // one-off holiday idea must stay a one-off.
                        specific_date: dateKey,
                        notes: activity.instructions || null,
                    });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : '';
                    if (/409|Conflicting/i.test(msg)) throw new ActivityConflictError();
                    throw err;
                }
            }
        },
        onSuccess: () => {
            // The activity is now a busy slot: the next suggestion round must
            // see it so it doesn't double-book the same hour.
            queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
        },
    });
};
