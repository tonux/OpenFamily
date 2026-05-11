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
