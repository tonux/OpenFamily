import { z } from 'zod';

export const classifyShoppingItemBodySchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(1, { message: 'name is required' })
            .max(255, { message: 'name is too long' }),
    })
    .strict();

export const parseShoppingNLBodySchema = z
    .object({
        text: z
            .string()
            .trim()
            .min(1, { message: 'text is required' })
            .max(1000, { message: 'text is too long (max 1000 chars)' }),
    })
    .strict();

export type ClassifyShoppingItemBody = z.infer<typeof classifyShoppingItemBodySchema>;
export type ParseShoppingNLBody = z.infer<typeof parseShoppingNLBodySchema>;

// Optional override coordinates for the dashboard widget when the user lets
// the browser share its current position. Both fields must be provided
// together; if neither is sent the route falls back to the persisted city.
export const clothingSuggestionsBodySchema = z
    .object({
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
    })
    .strict()
    .refine(
        (v) =>
            (v.latitude === undefined && v.longitude === undefined) ||
            (v.latitude !== undefined && v.longitude !== undefined),
        { message: 'latitude and longitude must be provided together' },
    );

export type ClothingSuggestionsBody = z.infer<typeof clothingSuggestionsBodySchema>;
