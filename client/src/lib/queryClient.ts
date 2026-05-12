import { QueryClient } from '@tanstack/react-query';

// =============================================================================
// Tanstack Query setup
//
// Phased rollout: the data layer of new and refactored pages now goes through
// React Query (cache, dedup, retries, optimistic updates). Legacy pages still
// use the imperative api.* calls — they will be migrated module by module.
//
// Defaults are chosen for a family app: low traffic, mostly user-driven
// refreshes, no high-frequency polling.
// =============================================================================
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Data is considered fresh for 30s — within that window navigating
            // away and back doesn't refetch.
            staleTime: 30_000,
            // Keep fetched data in memory for 5 min after it becomes unused.
            gcTime: 5 * 60_000,
            // Refetch automatically when the user returns to the tab.
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            // The api client already throws on non-2xx; let React Query treat
            // those as real failures rather than retrying blindly.
            retry: (failureCount, error) => {
                const msg = error instanceof Error ? error.message : '';
                // Don't retry auth failures — the api client has already
                // attempted a refresh.
                if (/unauthorized|HTTP 401/i.test(msg)) return false;
                return failureCount < 2;
            },
        },
        mutations: {
            retry: false,
        },
    },
});

// Shared key factory — consumers should pull from here so a single rename
// doesn't leak stale keys across components.
export const queryKeys = {
    shopping: {
        all: ['shopping'] as const,
        items: () => [...queryKeys.shopping.all, 'items'] as const,
        templates: () => [...queryKeys.shopping.all, 'templates'] as const,
    },
    dashboard: {
        all: ['dashboard'] as const,
        weatherClothing: (override: { latitude: number; longitude: number } | null) =>
            [...queryKeys.dashboard.all, 'weather-clothing', override] as const,
    },
    weather: {
        all: ['weather'] as const,
        weekly: (override: { latitude: number; longitude: number } | null, days: number) =>
            [...queryKeys.weather.all, 'weekly', override, days] as const,
    },
} as const;
