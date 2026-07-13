import { z } from 'zod';

// =============================================================================
// School breaks — the periods the kids spend at home instead of at school.
//
// Same conventions as schemas/garden.ts: .strict() to reject unknown keys, ISO
// date strings handed straight to PG, a PATCH schema that redeclares the shape
// as optional with a non-empty refine.
//
// Both bounds are INCLUSIVE, matching the resolver in lib/dayContext.ts and the
// CHECK constraint on the table.
// =============================================================================

const isoDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
    .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00`).getTime()), {
        message: 'date is not a real calendar date',
    });

const label = z.string().trim().min(1, { message: 'label is required' }).max(100);

export const schoolBreakBodySchema = z
    .object({
        label,
        start_date: isoDate,
        end_date: isoDate,
    })
    .strict()
    .refine((v) => v.start_date <= v.end_date, {
        message: 'end_date must be on or after start_date',
        path: ['end_date'],
    });

export const schoolBreakPatchSchema = z
    .object({
        label: label.optional(),
        start_date: isoDate.optional(),
        end_date: isoDate.optional(),
    })
    .strict()
    .refine((v) => Object.values(v).some((x) => x !== undefined), {
        message: 'at least one field must be provided',
    })
    // Only checkable when BOTH bounds are in the patch; a one-sided patch is
    // validated against the stored row in the route, which is the only place
    // that knows the other bound.
    .refine((v) => !(v.start_date && v.end_date) || v.start_date <= v.end_date, {
        message: 'end_date must be on or after start_date',
        path: ['end_date'],
    });

export type SchoolBreakBody = z.infer<typeof schoolBreakBodySchema>;
export type SchoolBreakPatch = z.infer<typeof schoolBreakPatchSchema>;
