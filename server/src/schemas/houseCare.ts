import { z } from 'zod';
import {
    CARE_CATEGORIES,
    CARE_FREQUENCIES,
    CARE_PRIORITIES,
    CARE_RESPONSIBILITIES,
    CARE_SEASONS,
} from '../lib/houseCareCatalog';

// =============================================================================
// House care program schemas — profile, recurring tasks, completion logs.
// Same conventions as schemas/house.ts: zod enums for restricted fields,
// .strict() to reject unknown keys, ISO date strings passed straight through.
// =============================================================================

export const DWELLING_TYPES = [
    'Unifamiliale',
    'Jumelé',
    'Maison en rangée',
    'Plain-pied',
    'Condo',
    'Chalet',
    'Autre',
] as const;
export type DwellingType = (typeof DWELLING_TYPES)[number];

export const CLIMATE_ZONES = [
    'Continental humide (hivers rigoureux)',
    'Tempéré océanique',
    'Méditerranéen',
    'Tropical / chaud',
] as const;
export type ClimateZone = (typeof CLIMATE_ZONES)[number];

export const HEATING_TYPES = [
    'Thermopompe',
    'Plinthes électriques',
    'Fournaise à air chaud',
    'Chaudière (eau chaude)',
    'Gaz naturel',
    'Mazout',
    'Poêle à bois',
    'Foyer',
    'Géothermie',
    'Autre',
] as const;
export type HeatingType = (typeof HEATING_TYPES)[number];

export const ROOF_TYPES = [
    'Bardeaux d’asphalte',
    'Tôle / métal',
    'Membrane élastomère',
    'Toit plat gravier',
    'Tuiles',
    'Autre',
] as const;

export const CARE_LOG_STATUSES = ['Fait', 'Ignoré', 'Problème'] as const;
export type CareLogStatus = (typeof CARE_LOG_STATUSES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Expected YYYY-MM-DD' });

const optionalNullable = <T extends z.ZodTypeAny>(schema: T) =>
    schema.nullish().transform((v) => (v === undefined ? undefined : v));

const optionalString = (max: number) =>
    optionalNullable(z.string().trim().max(max).or(z.literal(''))).transform((v) =>
        typeof v === 'string' && v.length === 0 ? null : v,
    );

// Build years are a common typo target ("19999"); bound them to something a
// house can actually have been built in, and allow next year for new builds.
const buildYear = z
    .number()
    .int()
    .min(1600)
    .max(new Date().getUTCFullYear() + 1);

// ---------- Profile ----------

export const houseProfileBodySchema = z
    .object({
        dwelling_type: z.enum(DWELLING_TYPES).optional(),
        build_year: optionalNullable(buildYear),
        living_area_m2: optionalNullable(z.number().min(0).max(10_000)),
        occupants: optionalNullable(z.number().int().min(0).max(30)),
        climate_zone: z.enum(CLIMATE_ZONES).optional(),
        has_basement: z.boolean().optional(),
        basement_finished: z.boolean().optional(),
        has_sump_pump: z.boolean().optional(),
        has_garage: z.boolean().optional(),
        has_pool: z.boolean().optional(),
        has_septic: z.boolean().optional(),
        has_well: z.boolean().optional(),
        has_irrigation: z.boolean().optional(),
        has_air_exchanger: z.boolean().optional(),
        heating_types: z.array(z.enum(HEATING_TYPES)).max(6).optional(),
        roof_type: optionalNullable(z.enum(ROOF_TYPES)),
        roof_year: optionalNullable(buildYear),
        water_heater_year: optionalNullable(buildYear),
        windows_year: optionalNullable(buildYear),
        siding_type: optionalString(40),
        property_value: optionalNullable(z.number().min(0).max(100_000_000)),
        notes: optionalString(2000),
    })
    .strict();

export type HouseProfileBody = z.infer<typeof houseProfileBodySchema>;

// ---------- Care tasks ----------

const monthNumber = z.number().int().min(1).max(12);

const careTaskShape = {
    title: z.string().trim().min(1).max(140),
    category: z.enum(CARE_CATEGORIES),
    season: z.enum(CARE_SEASONS),
    frequency: z.enum(CARE_FREQUENCIES),
    interval_months: optionalNullable(z.number().int().min(1).max(360)),
    month_start: optionalNullable(monthNumber),
    month_end: optionalNullable(monthNumber),
    priority: z.enum(CARE_PRIORITIES),
    responsibility: z.enum(CARE_RESPONSIBILITIES),
    estimated_minutes: optionalNullable(z.number().int().min(0).max(10_000)),
    estimated_cost: optionalNullable(z.number().min(0).max(10_000_000)),
    risk_if_skipped: optionalString(1000),
    steps: z.array(z.string().trim().min(1).max(400)).max(12).optional(),
    equipment_id: optionalNullable(z.string().uuid()),
    next_due_on: optionalNullable(isoDate),
    is_active: z.boolean().optional(),
};

// A window is either fully specified or absent — a task with only month_start
// would silently behave as "no window", which is the opposite of what the
// author meant.
const windowComplete = <T extends { month_start?: unknown; month_end?: unknown }>(v: T) =>
    (v.month_start == null) === (v.month_end == null);

export const careTaskBodySchema = z
    .object(careTaskShape)
    .strict()
    .refine(windowComplete, {
        message: 'month_start and month_end must be provided together',
        path: ['month_end'],
    });

export const careTaskPatchSchema = z
    .object({
        title: careTaskShape.title.optional(),
        category: careTaskShape.category.optional(),
        season: careTaskShape.season.optional(),
        frequency: careTaskShape.frequency.optional(),
        interval_months: careTaskShape.interval_months.optional(),
        month_start: careTaskShape.month_start.optional(),
        month_end: careTaskShape.month_end.optional(),
        priority: careTaskShape.priority.optional(),
        responsibility: careTaskShape.responsibility.optional(),
        estimated_minutes: careTaskShape.estimated_minutes.optional(),
        estimated_cost: careTaskShape.estimated_cost.optional(),
        risk_if_skipped: careTaskShape.risk_if_skipped.optional(),
        steps: careTaskShape.steps.optional(),
        equipment_id: careTaskShape.equipment_id.optional(),
        next_due_on: careTaskShape.next_due_on.optional(),
        is_active: careTaskShape.is_active.optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

/**
 * Bulk create — how an accepted AI proposal lands in the DB. Capped at 40 so a
 * runaway model response can't insert hundreds of rows in one call.
 */
export const careTasksBulkBodySchema = z
    .object({
        tasks: z.array(careTaskBodySchema).min(1).max(40),
        source: z.enum(['ai', 'manual']).optional(),
    })
    .strict();

export const careTaskListQuerySchema = z
    .object({
        season: z.enum(CARE_SEASONS).optional(),
        category: z.enum(CARE_CATEGORIES).optional(),
        frequency: z.enum(CARE_FREQUENCIES).optional(),
        priority: z.enum(CARE_PRIORITIES).optional(),
        /** 'due' = due today or earlier, 'overdue' = strictly late, 'week' = next 7 days. */
        status: z.enum(['all', 'due', 'overdue', 'week', 'season']).optional(),
        include_inactive: z.enum(['true', 'false']).optional(),
        search: z.string().trim().max(120).optional(),
    })
    .strict();

// ---------- Completion ----------

export const careCompleteBodySchema = z
    .object({
        done_on: optionalNullable(isoDate),
        status: z.enum(CARE_LOG_STATUSES).optional(),
        minutes_spent: optionalNullable(z.number().int().min(0).max(10_000)),
        cost: optionalNullable(z.number().min(0).max(10_000_000)),
        observation: optionalString(2000),
        /** Skip advancing next_due_on — used when logging a past completion. */
        keep_schedule: z.boolean().optional(),
    })
    .strict();

export const careLogListQuerySchema = z
    .object({
        task_id: z.string().uuid().optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        status: z.enum(CARE_LOG_STATUSES).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
    })
    .strict();

// ---------- Seeding ----------

export const careSeedBodySchema = z
    .object({
        /** Replace existing catalog tasks instead of only adding what's missing. */
        reset: z.boolean().optional().default(false),
    })
    .strict();
