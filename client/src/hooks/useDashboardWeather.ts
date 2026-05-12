import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryClient';

// =============================================================================
// Dashboard "weather + clothing suggestions" data hooks.
//
// One query (POST because the body carries optional override coords; the
// resource is per-user and short-lived) plus one mutation to update the saved
// city. The query is invalidated on successful city change so the widget
// refreshes with the new location.
// =============================================================================

export interface ForecastDTO {
    date: string;
    tempMin: number;
    tempMax: number;
    precipitationMm: number;
    precipitationProbability: number;
    windSpeedMax: number;
    weatherCode: number;
    label: string;
    timezone: string;
}

export interface ClothingKidDTO {
    id: string;
    name: string;
    color: string;
    birth_date: string | null;
    ageYears: number;
}

export interface ClothingSuggestionDTO {
    kidId: string;
    top: string[];
    bottom: string[];
    footwear: string[];
    accessories: string[];
    advice: string;
}

export type ClothingDegradedCode = 'DISABLED' | 'QUOTA_EXCEEDED' | 'BAD_JSON';

export interface DashboardWeatherDTO {
    weather: ForecastDTO;
    city: string | null;
    kids: ClothingKidDTO[];
    suggestions: ClothingSuggestionDTO[];
    cached: boolean;
    model: string;
    aiUnavailable?: boolean;
    code?: ClothingDegradedCode;
}

export interface NoLocationError {
    code: 'NO_LOCATION';
}

interface UpdatedUser {
    id: string;
    email: string;
    name: string;
    currency: string | null;
    city: string | null;
    country_code: string | null;
    latitude: number | null;
    longitude: number | null;
}

const ENDPOINT = '/api/ai/dashboard/clothing-suggestions';

/**
 * Fetch tomorrow's weather + per-kid clothing suggestions. When `override`
 * is provided (browser geolocation), the server uses those coordinates but
 * does NOT persist them.
 *
 * Returns `enabled: false` when no override is provided and the user has no
 * saved city yet — the caller can still render the component since React
 * Query will simply not run the query.
 */
export const useDashboardWeather = (
    override: { latitude: number; longitude: number } | null,
    options?: { enabled?: boolean },
) =>
    useQuery({
        queryKey: queryKeys.dashboard.weatherClothing(override),
        queryFn: async () => {
            const response = await api.post<{ success: boolean; data: DashboardWeatherDTO }>(
                ENDPOINT,
                override ?? {},
            );
            return response.data;
        },
        // Weather data updates hourly at most — keep it for 5 min on the client.
        staleTime: 5 * 60_000,
        enabled: options?.enabled ?? true,
        // Single retry: most failures are transient (Open-Meteo hiccups).
        // Auth & validation errors are filtered out by the global default.
        retry: (count, error) => {
            const msg = error instanceof Error ? error.message : '';
            if (/NO_LOCATION|CITY_NOT_FOUND|HTTP 4\d\d/i.test(msg)) return false;
            return count < 1;
        },
    });

export const useUpdateUserLocation = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (city: string) => {
            const response = await api.patch<{ success: boolean; data: { user: UpdatedUser } }>(
                '/api/auth/me/location',
                { city },
            );
            return response.data.user;
        },
        onSuccess: () => {
            // Force a refetch of the widget AND any open weather details.
            queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.weather.all });
        },
    });
};

// ---------------------------------------------------------------------------
// Weekly forecast (used by the "weather details" modal)
// ---------------------------------------------------------------------------

export interface DailyForecastDTO {
    date: string;
    tempMin: number;
    tempMax: number;
    apparentTempMin: number;
    apparentTempMax: number;
    precipitationMm: number;
    precipitationProbability: number;
    windSpeedMax: number;
    weatherCode: number;
    label: string;
    sunrise: string | null;
    sunset: string | null;
    uvIndexMax: number | null;
}

export interface WeeklyForecastDTO {
    days: DailyForecastDTO[];
    timezone: string;
    city: string | null;
}

/**
 * Fetch the multi-day forecast for the currently effective coordinates.
 * Mirrors the override semantics of `useDashboardWeather` so the user's
 * geolocation toggle on the dashboard widget also drives the details modal.
 */
export const useWeeklyForecast = (
    override: { latitude: number; longitude: number } | null,
    options?: { enabled?: boolean; days?: number },
) => {
    const days = options?.days ?? 7;
    return useQuery({
        queryKey: queryKeys.weather.weekly(override, days),
        queryFn: async () => {
            const response = await api.post<{ success: boolean; data: WeeklyForecastDTO }>(
                '/api/weather/forecast',
                { ...(override ?? {}), days },
            );
            return response.data;
        },
        staleTime: 10 * 60_000,
        enabled: options?.enabled ?? true,
        retry: (count, error) => {
            const msg = error instanceof Error ? error.message : '';
            if (/NO_LOCATION|HTTP 4\d\d/i.test(msg)) return false;
            return count < 1;
        },
    });
};
