import { z } from 'zod';

// =============================================================================
// /api/statements validation schemas
//
// The import route itself takes multipart/form-data, so it is validated by
// multer plus hand-written checks in the route — zod does not see the file.
// Everything after the upload (review edits, confirmation, listing) is plain
// JSON and goes through the schemas below.
// =============================================================================

export const statementIdParamsSchema = z.object({
    id: z.string().uuid({ message: 'Expected a statement UUID' }),
});

export const statementTransactionParamsSchema = z.object({
    id: z.string().uuid({ message: 'Expected a statement UUID' }),
    txId: z.string().uuid({ message: 'Expected a transaction UUID' }),
});

export const statementListQuerySchema = z
    .object({
        status: z.enum(['pending_review', 'imported', 'failed']).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
    })
    .strict();

/**
 * Which calendar month the coverage report describes. A month is the unit the
 * budget page navigates by, even though statement periods rarely align with
 * one — reconciling the two is the whole job of the endpoint.
 */
export const statementCoverageQuerySchema = z
    .object({
        month: z.coerce.number().int().min(1).max(12),
        year: z.coerce.number().int().min(1970).max(2100),
    })
    .strict();

/**
 * Review edits. Every field is optional — the review table sends only what the
 * user actually changed, so a category fix does not have to round-trip the
 * amount and risk clobbering a concurrent edit.
 *
 * `status` intentionally does NOT accept 'imported': a row becomes imported
 * only through the confirm endpoint, which is the single place that writes to
 * budget_entries.
 */
export const statementTransactionPatchSchema = z
    .object({
        category: z.string().trim().min(1).max(50).optional(),
        description: z.string().trim().min(1).max(200).optional(),
        merchant: z.string().trim().max(160).nullable().optional(),
        amount: z.coerce.number().positive().max(1_000_000).optional(),
        is_expense: z.boolean().optional(),
        assigned_to: z.string().uuid().nullable().optional(),
        transaction_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Expected YYYY-MM-DD' })
            .optional(),
        status: z.enum(['pending', 'ignored', 'duplicate']).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, {
        message: 'At least one field must be provided',
    });

/**
 * Bulk action on the review table, so "ignore all the card payments" is one
 * request instead of forty.
 */
export const statementBulkPatchSchema = z
    .object({
        transaction_ids: z.array(z.string().uuid()).min(1).max(500),
        status: z.enum(['pending', 'ignored']).optional(),
        category: z.string().trim().min(1).max(50).optional(),
        assigned_to: z.string().uuid().nullable().optional(),
    })
    .strict()
    .refine((v) => v.status !== undefined || v.category !== undefined || 'assigned_to' in v, {
        message: 'Provide at least one of status, category or assigned_to',
    });

export const statementConfirmSchema = z
    .object({
        /**
         * Import rows flagged as duplicates too. Off by default: the whole
         * point of the flag is that these lines already exist in the budget.
         */
        include_duplicates: z.boolean().optional().default(false),
        /** Attribute every created entry to one family member. */
        assigned_to: z.string().uuid().nullable().optional(),
    })
    .strict();

export const statementDeleteQuerySchema = z
    .object({
        /**
         * Also delete the budget_entries this statement created. Default false
         * so removing a statement from the list never silently rewrites the
         * user's budget history.
         */
        with_entries: z
            .union([z.literal('true'), z.literal('false'), z.boolean()])
            .optional()
            .transform((v) => v === true || v === 'true'),
    })
    .strict();

export type StatementTransactionPatch = z.infer<typeof statementTransactionPatchSchema>;
export type StatementBulkPatch = z.infer<typeof statementBulkPatchSchema>;
export type StatementConfirmBody = z.infer<typeof statementConfirmSchema>;
