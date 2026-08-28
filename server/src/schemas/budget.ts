import { z } from 'zod';

// =============================================================================
// /api/budget validation schemas
//
// Only the statistics endpoints go through zod today; the entry/limit routes
// still use the hand-rolled checks they were written with. New surface gets
// schemas so the query contract lives in one readable place.
// =============================================================================

/**
 * Which rows of budget_entries the statistics should describe.
 *
 * 'statement' is the household's real spending as the bank recorded it;
 * 'manual' is what somebody remembered to type in. They are kept separable
 * because trusting their sum blindly is exactly how a forgotten purchase — or
 * the same purchase counted twice — hides inside a monthly total.
 */
export const BUDGET_SOURCES = ['all', 'statement', 'manual'] as const;
export type BudgetSource = (typeof BUDGET_SOURCES)[number];

const sourceField = z.enum(BUDGET_SOURCES).optional().default('all');

const monthField = z.coerce.number().int().min(1).max(12);
const yearField = z.coerce.number().int().min(1970).max(2100);

export const budgetStatisticsQuerySchema = z
    .object({
        month: monthField,
        year: yearField,
        source: sourceField,
    })
    .strict();

export const budgetMonthlyStatisticsQuerySchema = z
    .object({
        year: yearField,
        source: sourceField,
    })
    .strict();

export const budgetPeriodQuerySchema = z
    .object({
        month: monthField,
        year: yearField,
    })
    .strict();

export type BudgetStatisticsQuery = z.infer<typeof budgetStatisticsQuerySchema>;
export type BudgetMonthlyStatisticsQuery = z.infer<typeof budgetMonthlyStatisticsQuerySchema>;
export type BudgetPeriodQuery = z.infer<typeof budgetPeriodQuerySchema>;
