import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryClient';

// =============================================================================
// School breaks — the periods the kids are home instead of at school.
//
// Declaring these is optional: the server ships a July/August fallback, so the
// dashboard already behaves during the summer without a single row here. What
// this buys you is the rest of the year (Toussaint, Noël, février, Pâques) and
// a summer that doesn't run exactly 1 July → 31 August.
//
// Every mutation invalidates the dashboard: the day context (and therefore the
// card titles AND which cards mount at all) is derived from these rows.
// =============================================================================

export interface SchoolBreak {
    id: string;
    label: string;
    /** YYYY-MM-DD, inclusive */
    start_date: string;
    /** YYYY-MM-DD, inclusive */
    end_date: string;
}

export type SchoolBreakInput = Omit<SchoolBreak, 'id'>;

const ENDPOINT = '/api/school-breaks';

export const useSchoolBreaks = () =>
    useQuery({
        queryKey: queryKeys.schoolBreaks.list(),
        queryFn: async () => {
            const response = await api.get<{ success: boolean; data: SchoolBreak[] }>(ENDPOINT);
            return response.data;
        },
    });

/** Both dashboard cards read the day context, so any change must refresh them. */
const useInvalidate = () => {
    const queryClient = useQueryClient();
    return () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.schoolBreaks.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    };
};

export const useCreateSchoolBreak = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: async (input: SchoolBreakInput) => {
            const response = await api.post<{ success: boolean; data: SchoolBreak }>(
                ENDPOINT,
                input,
            );
            return response.data;
        },
        onSuccess: invalidate,
    });
};

export const useUpdateSchoolBreak = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: async ({ id, ...patch }: Partial<SchoolBreakInput> & { id: string }) => {
            const response = await api.patch<{ success: boolean; data: SchoolBreak }>(
                `${ENDPOINT}/${id}`,
                patch,
            );
            return response.data;
        },
        onSuccess: invalidate,
    });
};

export const useDeleteSchoolBreak = () => {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`${ENDPOINT}/${id}`);
        },
        onSuccess: invalidate,
    });
};
