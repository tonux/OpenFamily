import { z } from 'zod';

// POST /api/weather/forecast — same override semantics as the dashboard AI
// endpoint: latitude+longitude must be provided together, otherwise the route
// falls back to the persisted user.city. `days` caps the daily horizon.
export const weeklyForecastBodySchema = z
    .object({
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        days: z.number().int().min(1).max(14).optional(),
    })
    .strict()
    .refine(
        (v) =>
            (v.latitude === undefined && v.longitude === undefined) ||
            (v.latitude !== undefined && v.longitude !== undefined),
        { message: 'latitude and longitude must be provided together' },
    );

export type WeeklyForecastBody = z.infer<typeof weeklyForecastBodySchema>;
