import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryClient';
import type { ClothingKidDTO, DayContextDTO, ForecastDTO } from './useDashboardWeather';

// =============================================================================
// Dashboard "screen-free activities" data hook.
//
// Mirrors useDashboardWeather: POST because the body carries optional override
// coordinates, per-user, short-lived. `exclude` carries the titles already
// shown so the "other ideas" button can ask the model for something new — it is
// part of the query key, so each regeneration is its own cache entry.
// =============================================================================

export type ActivityCategory =
    | 'outdoor'
    | 'creative'
    | 'cooking'
    | 'learning'
    | 'sport'
    | 'chores'
    | 'social';

export type ActivityTimeOfDay = 'morning' | 'afternoon' | 'evening';

export interface KidActivityDTO {
    kidIds: string[];
    title: string;
    category: ActivityCategory;
    timeOfDay: ActivityTimeOfDay;
    durationMinutes: number;
    materials: string[];
    instructions: string;
}

/**
 * Any AiError code can land here: unlike the clothing widget, this card
 * degrades on every AI failure (outage, timeout, rate limit…) rather than
 * erroring, because it must never render empty. Codes beyond the three named
 * ones fall back to a generic wording client-side.
 */
export type ActivitiesDegradedCode = 'DISABLED' | 'QUOTA_EXCEEDED' | 'BAD_JSON' | (string & {});

export interface KidsActivitiesDTO {
    weather: ForecastDTO;
    city: string | null;
    kids: ClothingKidDTO[];
    dayContext: DayContextDTO;
    activities: KidActivityDTO[];
    cached: boolean;
    model: string;
    /** True when the ideas come from the static bank rather than the model. */
    aiUnavailable?: boolean;
    code?: ActivitiesDegradedCode;
}

const ENDPOINT = '/api/ai/dashboard/kids-activities';

export const useKidsActivities = (
    override: { latitude: number; longitude: number } | null,
    exclude: string[],
    options?: { enabled?: boolean },
) =>
    useQuery({
        queryKey: queryKeys.dashboard.kidsActivities(override, exclude),
        queryFn: async () => {
            const response = await api.post<{ success: boolean; data: KidsActivitiesDTO }>(
                ENDPOINT,
                { ...(override ?? {}), ...(exclude.length > 0 ? { exclude } : {}) },
            );
            return response.data;
        },
        // The suggestions are pinned to a calendar day server-side; there is no
        // point refetching them every few minutes.
        staleTime: 30 * 60_000,
        enabled: options?.enabled ?? true,
        retry: (count, error) => {
            const msg = error instanceof Error ? error.message : '';
            if (/NO_LOCATION|CITY_NOT_FOUND|HTTP 4\d\d/i.test(msg)) return false;
            return count < 1;
        },
    });
