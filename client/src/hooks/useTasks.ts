import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryClient';

// =============================================================================
// Tasks hooks (partial — Phase 2 only the dashboard widget consumes these).
// The Tasks page itself still uses imperative api.* calls; we'll migrate
// when there's a clear need.
// =============================================================================

export interface TaskMember {
    id: string;
    name: string;
    color: string;
}

export interface Task {
    id: string;
    user_id: string;
    title: string;
    description: string | null;
    is_completed: boolean;
    due_date: string | null;
    frequency: string | null;
    priority: string | null;
    assigned_to: string[];
    assigned_to_members?: TaskMember[];
    completed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface TodayTasksPayload {
    today: Task[];
    overdue: Task[];
    upcoming_count: number;
}

export const useTodayTasks = () =>
    useQuery({
        queryKey: queryKeys.tasks.today(),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: TodayTasksPayload }>(
                '/api/tasks/today',
            );
            return r.data;
        },
        staleTime: 60_000,
    });

interface UpdateTaskInput {
    id: string;
    patch: Partial<
        Pick<
            Task,
            | 'is_completed'
            | 'title'
            | 'due_date'
            | 'description'
            | 'frequency'
            | 'priority'
            | 'assigned_to'
        >
    >;
}

interface UpdateTaskResult extends Task {
    next_occurrence: Task | null;
}

/**
 * Generic task update — used by the dashboard widget to mark-as-done. The
 * server handles auto-recurrence and returns `next_occurrence` when a new
 * instance was created.
 */
export const useUpdateTask = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, patch }: UpdateTaskInput) => {
            const r = await api.put<{ success: boolean; data: UpdateTaskResult }>(
                `/api/tasks/${id}`,
                patch,
            );
            return r.data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: queryKeys.tasks.all });
            // Dashboard KPIs include task counts — refresh them too.
            qc.invalidateQueries({ queryKey: ['dashboard'] });
        },
    });
};
