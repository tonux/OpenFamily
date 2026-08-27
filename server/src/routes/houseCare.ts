import { Router } from 'express';
import { getClient, query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
    careCompleteBodySchema,
    careLogListQuerySchema,
    careSeedBodySchema,
    careTaskBodySchema,
    careTaskListQuerySchema,
    careTaskPatchSchema,
    careTasksBulkBodySchema,
    houseProfileBodySchema,
} from '../schemas/houseCare';
import {
    climateFamilyFor,
    requirementsForProfile,
    selectCatalogForProfile,
    type CareCatalogEntry,
} from '../lib/houseCareCatalog';
import {
    initialDueDate,
    isInSeason,
    nextDueAfterCompletion,
    seasonForMonth,
    toIsoDate,
} from '../lib/houseCareSchedule';
import logger from '../lib/logger';

// =============================================================================
// /api/house/care — the seasonal home-care program.
//
// Distinct from /api/house/maintenance, which logs interventions on a specific
// piece of equipment. This module is about the PROPERTY: the recurring, mostly
// seasonal work that keeps a house from turning into a repair bill, plus the
// weekly ten-minute tour that catches water damage while it's still cheap.
//
// Three resources:
//   - profile — the facts about the house; drives both the seeded plan and the
//     AI's advice. One row per user, upserted.
//   - tasks   — the program itself. Seeded from the curated catalog, extended
//     by the AI (always through an explicit user confirmation), editable.
//   - logs    — completion history, including 'Problème' entries which are the
//     most valuable input the AI briefing gets.
//
// next_due_on is denormalised on the task and recomputed on completion; see
// lib/houseCareSchedule.ts for the seasonal-window snapping rules.
// =============================================================================

const router = Router();
router.use(authMiddleware);

const today = (): string => toIsoDate(new Date());

const PROFILE_DEFAULTS = {
    dwelling_type: 'Unifamiliale',
    build_year: null,
    living_area_m2: null,
    occupants: null,
    climate_zone: 'Continental humide (hivers rigoureux)',
    has_basement: true,
    basement_finished: false,
    has_sump_pump: false,
    has_garage: false,
    has_pool: false,
    has_septic: false,
    has_well: false,
    has_irrigation: false,
    has_air_exchanger: false,
    heating_types: [] as string[],
    roof_type: null,
    roof_year: null,
    water_heater_year: null,
    windows_year: null,
    siding_type: null,
    property_value: null,
    notes: null,
};

const mapProfile = (row: any) => ({
    dwelling_type: row.dwelling_type as string,
    build_year: row.build_year ?? null,
    living_area_m2: row.living_area_m2 !== null ? Number(row.living_area_m2) : null,
    occupants: row.occupants ?? null,
    climate_zone: row.climate_zone as string,
    has_basement: Boolean(row.has_basement),
    basement_finished: Boolean(row.basement_finished),
    has_sump_pump: Boolean(row.has_sump_pump),
    has_garage: Boolean(row.has_garage),
    has_pool: Boolean(row.has_pool),
    has_septic: Boolean(row.has_septic),
    has_well: Boolean(row.has_well),
    has_irrigation: Boolean(row.has_irrigation),
    has_air_exchanger: Boolean(row.has_air_exchanger),
    heating_types: Array.isArray(row.heating_types) ? (row.heating_types as string[]) : [],
    roof_type: row.roof_type ?? null,
    roof_year: row.roof_year ?? null,
    water_heater_year: row.water_heater_year ?? null,
    windows_year: row.windows_year ?? null,
    siding_type: row.siding_type ?? null,
    property_value: row.property_value !== null ? Number(row.property_value) : null,
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

const mapCareTask = (row: any) => ({
    id: row.id as string,
    title: row.title as string,
    category: row.category as string,
    season: row.season as string,
    frequency: row.frequency as string,
    interval_months: row.interval_months ?? null,
    month_start: row.month_start ?? null,
    month_end: row.month_end ?? null,
    priority: row.priority as string,
    responsibility: row.responsibility as string,
    estimated_minutes: row.estimated_minutes ?? null,
    estimated_cost: row.estimated_cost !== null ? Number(row.estimated_cost) : null,
    risk_if_skipped: row.risk_if_skipped ?? null,
    steps: Array.isArray(row.steps) ? (row.steps as string[]) : [],
    equipment_id: row.equipment_id ?? null,
    source: row.source as string,
    catalog_key: row.catalog_key ?? null,
    is_active: Boolean(row.is_active),
    last_done_on: row.last_done_on ?? null,
    next_due_on: row.next_due_on ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    equipment_name: row.equipment_name ?? undefined,
});

const mapCareLog = (row: any) => ({
    id: row.id as string,
    task_id: row.task_id as string,
    done_on: row.done_on as string,
    status: row.status as string,
    minutes_spent: row.minutes_spent ?? null,
    cost: row.cost !== null ? Number(row.cost) : null,
    observation: row.observation ?? null,
    created_at: row.created_at,
    task_title: row.task_title ?? undefined,
    task_category: row.task_category ?? undefined,
});

/**
 * Load the profile row, or the defaults when the user hasn't filled it in.
 * The program has to work before onboarding: a brand-new owner gets a sensible
 * cold-climate single-family plan and refines it after.
 */
const loadProfile = async (userId: string) => {
    const r = await query('SELECT * FROM house_profile WHERE user_id = $1', [userId]);
    if (r.rows.length === 0) return { ...PROFILE_DEFAULTS, exists: false };
    return { ...mapProfile(r.rows[0]), exists: true };
};

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

router.get('/profile', async (req: AuthRequest, res) => {
    try {
        res.json({ success: true, data: await loadProfile(req.userId!) });
    } catch (error) {
        logger.error('houseCare.profile_get_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

const PROFILE_COLUMNS = [
    'dwelling_type',
    'build_year',
    'living_area_m2',
    'occupants',
    'climate_zone',
    'has_basement',
    'basement_finished',
    'has_sump_pump',
    'has_garage',
    'has_pool',
    'has_septic',
    'has_well',
    'has_irrigation',
    'has_air_exchanger',
    'heating_types',
    'roof_type',
    'roof_year',
    'water_heater_year',
    'windows_year',
    'siding_type',
    'property_value',
    'notes',
] as const;

/**
 * PUT /profile — upsert. Only the keys present in the body are written, so the
 * onboarding wizard can save section by section without wiping the rest.
 */
router.put(
    '/profile',
    validate({ body: houseProfileBodySchema }),
    async (req: AuthRequest, res) => {
        try {
            const body = req.body as Record<string, unknown>;
            const present = PROFILE_COLUMNS.filter((c) => body[c] !== undefined);

            if (present.length === 0) {
                return res.json({ success: true, data: await loadProfile(req.userId!) });
            }

            const values: unknown[] = [req.userId];
            const insertCols: string[] = ['user_id'];
            const insertPlaceholders: string[] = ['$1'];
            const updates: string[] = [];

            for (const col of present) {
                // heating_types is JSONB; everything else binds directly.
                const raw = body[col];
                values.push(col === 'heating_types' ? JSON.stringify(raw ?? []) : raw);
                const ph = `$${values.length}${col === 'heating_types' ? '::jsonb' : ''}`;
                insertCols.push(col);
                insertPlaceholders.push(ph);
                updates.push(`${col} = ${ph}`);
            }

            const r = await query(
                `INSERT INTO house_profile (${insertCols.join(', ')})
             VALUES (${insertPlaceholders.join(', ')})
             ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}
             RETURNING *`,
                values,
            );
            res.json({ success: true, data: { ...mapProfile(r.rows[0]), exists: true } });
        } catch (error) {
            logger.error('houseCare.profile_put_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

router.get(
    '/tasks',
    validate({ query: careTaskListQuerySchema }),
    async (req: AuthRequest, res) => {
        try {
            const { season, category, frequency, priority, status, include_inactive, search } =
                req.query as Record<string, string | undefined>;

            const conditions = ['t.user_id = $1'];
            const params: unknown[] = [req.userId];

            if (include_inactive !== 'true') conditions.push('t.is_active = true');
            if (season) {
                params.push(season);
                conditions.push(`t.season = $${params.length}`);
            }
            if (category) {
                params.push(category);
                conditions.push(`t.category = $${params.length}`);
            }
            if (frequency) {
                params.push(frequency);
                conditions.push(`t.frequency = $${params.length}`);
            }
            if (priority) {
                params.push(priority);
                conditions.push(`t.priority = $${params.length}`);
            }
            if (search) {
                params.push(`%${search}%`);
                conditions.push(`t.title ILIKE $${params.length}`);
            }
            if (status === 'due') {
                conditions.push('t.next_due_on IS NOT NULL AND t.next_due_on <= CURRENT_DATE');
            } else if (status === 'overdue') {
                conditions.push('t.next_due_on IS NOT NULL AND t.next_due_on < CURRENT_DATE');
            } else if (status === 'week') {
                conditions.push(
                    "t.next_due_on IS NOT NULL AND t.next_due_on <= CURRENT_DATE + INTERVAL '7 days'",
                );
            }

            const r = await query(
                `SELECT t.*, e.name AS equipment_name
                 FROM house_care_tasks t
                 LEFT JOIN house_equipments e ON t.equipment_id = e.id
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY t.next_due_on ASC NULLS LAST, t.priority ASC, t.title ASC
                 LIMIT 400`,
                params,
            );

            let rows = r.rows;
            // 'season' filters on the current calendar month rather than the
            // stored label, so a task whose window is 12→3 still shows up in
            // January even though its season is 'Hiver'. Done in JS because the
            // wrapping-window predicate is awkward and unindexable in SQL.
            if (status === 'season') {
                const month = new Date().getUTCMonth() + 1;
                rows = rows.filter((row: any) => isInSeason(row, month));
            }

            res.json({ success: true, data: rows.map(mapCareTask) });
        } catch (error) {
            logger.error('houseCare.tasks_list_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

const insertTask = async (
    userId: string,
    body: any,
    source: 'manual' | 'ai' | 'catalog',
    catalogKey: string | null,
    executor: { query: (sql: string, params?: unknown[]) => Promise<any> } = { query },
) => {
    const task = {
        frequency: body.frequency,
        interval_months: body.interval_months ?? null,
        month_start: body.month_start ?? null,
        month_end: body.month_end ?? null,
    };
    const due = body.next_due_on ?? initialDueDate(task, today());

    const r = await executor.query(
        `INSERT INTO house_care_tasks
            (user_id, title, category, season, frequency, interval_months, month_start,
             month_end, priority, responsibility, estimated_minutes, estimated_cost,
             risk_if_skipped, steps, equipment_id, source, catalog_key, next_due_on, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19)
         RETURNING *`,
        [
            userId,
            body.title,
            body.category,
            body.season,
            body.frequency,
            body.interval_months ?? null,
            body.month_start ?? null,
            body.month_end ?? null,
            body.priority,
            body.responsibility,
            body.estimated_minutes ?? null,
            body.estimated_cost ?? null,
            body.risk_if_skipped ?? null,
            JSON.stringify(body.steps ?? []),
            body.equipment_id ?? null,
            source,
            catalogKey,
            due,
            body.is_active ?? true,
        ],
    );
    return r.rows[0];
};

router.post('/tasks', validate({ body: careTaskBodySchema }), async (req: AuthRequest, res) => {
    try {
        const row = await insertTask(req.userId!, req.body, 'manual', null);
        res.status(201).json({ success: true, data: mapCareTask(row) });
    } catch (error) {
        logger.error('houseCare.task_create_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /tasks/bulk — how an accepted AI plan lands in the DB.
 *
 * Human-in-the-loop by construction: the AI endpoint only ever returns a
 * proposal, and this route is what the client calls after the user has
 * reviewed and unchecked what they don't want. All-or-nothing in one
 * transaction so a partial plan never gets committed.
 */
router.post(
    '/tasks/bulk',
    validate({ body: careTasksBulkBodySchema }),
    async (req: AuthRequest, res) => {
        const client = await getClient();
        try {
            await client.query('BEGIN');
            const source = (req.body.source as 'ai' | 'manual') ?? 'ai';
            const created = [];
            for (const task of req.body.tasks) {
                created.push(await insertTask(req.userId!, task, source, null, client));
            }
            await client.query('COMMIT');
            res.status(201).json({ success: true, data: created.map(mapCareTask) });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            logger.error('houseCare.tasks_bulk_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        } finally {
            client.release();
        }
    },
);

router.get('/tasks/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            `SELECT t.*, e.name AS equipment_name
             FROM house_care_tasks t
             LEFT JOIN house_equipments e ON t.equipment_id = e.id
             WHERE t.id = $1 AND t.user_id = $2`,
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }
        const logs = await query(
            `SELECT * FROM house_care_logs
             WHERE task_id = $1 AND user_id = $2
             ORDER BY done_on DESC LIMIT 20`,
            [req.params.id, req.userId],
        );
        res.json({
            success: true,
            data: { ...mapCareTask(r.rows[0]), history: logs.rows.map(mapCareLog) },
        });
    } catch (error) {
        logger.error('houseCare.task_get_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.patch(
    '/tasks/:id',
    validate({ body: careTaskPatchSchema }),
    async (req: AuthRequest, res) => {
        try {
            const body = req.body as Record<string, unknown>;
            const columns = [
                'title',
                'category',
                'season',
                'frequency',
                'interval_months',
                'month_start',
                'month_end',
                'priority',
                'responsibility',
                'estimated_minutes',
                'estimated_cost',
                'risk_if_skipped',
                'steps',
                'equipment_id',
                'next_due_on',
                'is_active',
            ];
            const sets: string[] = [];
            const params: unknown[] = [];
            for (const col of columns) {
                if (body[col] === undefined) continue;
                params.push(col === 'steps' ? JSON.stringify(body[col] ?? []) : body[col]);
                sets.push(`${col} = $${params.length}${col === 'steps' ? '::jsonb' : ''}`);
            }
            if (sets.length === 0) {
                return res.status(400).json({ success: false, error: 'No fields to update' });
            }
            params.push(req.params.id, req.userId);
            const r = await query(
                `UPDATE house_care_tasks SET ${sets.join(', ')}
                 WHERE id = $${params.length - 1} AND user_id = $${params.length}
                 RETURNING *`,
                params,
            );
            if (r.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Task not found' });
            }
            res.json({ success: true, data: mapCareTask(r.rows[0]) });
        } catch (error) {
            logger.error('houseCare.task_patch_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

router.delete('/tasks/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            'DELETE FROM house_care_tasks WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }
        res.json({ success: true, data: { id: r.rows[0].id } });
    } catch (error) {
        logger.error('houseCare.task_delete_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /tasks/:id/complete — log a completion and advance the schedule.
 *
 * The log row and the task update go in one transaction: a completion that
 * records history without moving the due date (or the reverse) leaves the
 * program lying to the user about what's outstanding.
 *
 * `keep_schedule` exists for back-dating: "I actually did this in October"
 * should record the history without pushing the next occurrence out from a
 * stale date.
 */
router.post(
    '/tasks/:id/complete',
    validate({ body: careCompleteBodySchema }),
    async (req: AuthRequest, res) => {
        const client = await getClient();
        try {
            await client.query('BEGIN');
            const taskRes = await client.query(
                'SELECT * FROM house_care_tasks WHERE id = $1 AND user_id = $2 FOR UPDATE',
                [req.params.id, req.userId],
            );
            if (taskRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Task not found' });
            }
            const task = taskRes.rows[0];
            const doneOn = (req.body.done_on as string) ?? today();
            const status = (req.body.status as string) ?? 'Fait';

            await client.query(
                `INSERT INTO house_care_logs
                    (user_id, task_id, done_on, status, minutes_spent, cost, observation)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    req.userId,
                    task.id,
                    doneOn,
                    status,
                    req.body.minutes_spent ?? null,
                    req.body.cost ?? null,
                    req.body.observation ?? null,
                ],
            );

            // 'Ignoré' records the decision but must not pretend the work was
            // done: the task stays due so it keeps showing up.
            const advance = status !== 'Ignoré' && req.body.keep_schedule !== true;
            let updated = task;
            if (advance) {
                const nextDue = nextDueAfterCompletion(task, doneOn);
                const r = await client.query(
                    `UPDATE house_care_tasks SET last_done_on = $1, next_due_on = $2
                     WHERE id = $3 AND user_id = $4 RETURNING *`,
                    [doneOn, nextDue, task.id, req.userId],
                );
                updated = r.rows[0];
            }

            await client.query('COMMIT');
            res.json({ success: true, data: mapCareTask(updated) });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            logger.error('houseCare.task_complete_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        } finally {
            client.release();
        }
    },
);

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

router.get('/logs', validate({ query: careLogListQuerySchema }), async (req: AuthRequest, res) => {
    try {
        const { task_id, from, to, status, limit } = req.query as Record<
            string,
            string | undefined
        >;
        const conditions = ['l.user_id = $1'];
        const params: unknown[] = [req.userId];
        if (task_id) {
            params.push(task_id);
            conditions.push(`l.task_id = $${params.length}`);
        }
        if (from) {
            params.push(from);
            conditions.push(`l.done_on >= $${params.length}`);
        }
        if (to) {
            params.push(to);
            conditions.push(`l.done_on <= $${params.length}`);
        }
        if (status) {
            params.push(status);
            conditions.push(`l.status = $${params.length}`);
        }
        params.push(Number(limit ?? 60));

        const r = await query(
            `SELECT l.*, t.title AS task_title, t.category AS task_category
             FROM house_care_logs l
             JOIN house_care_tasks t ON l.task_id = t.id
             WHERE ${conditions.join(' AND ')}
             ORDER BY l.done_on DESC, l.created_at DESC
             LIMIT $${params.length}`,
            params,
        );
        res.json({ success: true, data: r.rows.map(mapCareLog) });
    } catch (error) {
        logger.error('houseCare.logs_list_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// Seeding from the curated catalog
// ---------------------------------------------------------------------------

const catalogToTaskBody = (entry: CareCatalogEntry) => ({
    title: entry.title,
    category: entry.category,
    season: entry.season,
    frequency: entry.frequency,
    interval_months: entry.intervalMonths,
    month_start: entry.monthStart,
    month_end: entry.monthEnd,
    priority: entry.priority,
    responsibility: entry.responsibility,
    estimated_minutes: entry.estimatedMinutes,
    estimated_cost: entry.estimatedCost,
    risk_if_skipped: entry.riskIfSkipped,
    steps: entry.steps,
});

/**
 * POST /seed — install (or top up) the baseline program for this house.
 *
 * Idempotent: catalog rows carry a stable `catalog_key` with a partial unique
 * index, so re-seeding after adding a pool adds only the pool tasks. `reset`
 * deletes the catalog-sourced rows first — it never touches manual or AI tasks,
 * which are the user's own work.
 */
router.post('/seed', validate({ body: careSeedBodySchema }), async (req: AuthRequest, res) => {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const profileRes = await client.query('SELECT * FROM house_profile WHERE user_id = $1', [
            req.userId,
        ]);
        const profile = profileRes.rows[0] ?? PROFILE_DEFAULTS;

        const entries = selectCatalogForProfile({
            climate: climateFamilyFor(profile.climate_zone),
            requirements: requirementsForProfile(profile),
        });

        if (req.body.reset === true) {
            await client.query(
                "DELETE FROM house_care_tasks WHERE user_id = $1 AND source = 'catalog'",
                [req.userId],
            );
        }

        const existing = await client.query(
            'SELECT catalog_key FROM house_care_tasks WHERE user_id = $1 AND catalog_key IS NOT NULL',
            [req.userId],
        );
        const known = new Set(existing.rows.map((r: any) => r.catalog_key as string));

        const created = [];
        for (const entry of entries) {
            if (known.has(entry.key)) continue;
            created.push(
                await insertTask(
                    req.userId!,
                    catalogToTaskBody(entry),
                    'catalog',
                    entry.key,
                    client,
                ),
            );
        }

        await client.query('COMMIT');
        logger.info('houseCare.seeded', {
            userId: req.userId,
            created: created.length,
            applicable: entries.length,
        });
        res.status(201).json({
            success: true,
            data: {
                created: created.map(mapCareTask),
                created_count: created.length,
                applicable_count: entries.length,
                skipped_count: entries.length - created.length,
            },
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        logger.error('houseCare.seed_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------------
// Overview — everything the Entretien tab and the dashboard card need, in one
// round trip: the weekly tour, what's late, what's coming, and the big-ticket
// horizon derived from the profile's install years.
// ---------------------------------------------------------------------------

/** Expected service life, in years, for the components we track a year for. */
const LIFESPAN_YEARS: Record<string, { years: number; label: string; cost: number }> = {
    roof_year: { years: 22, label: 'Toiture', cost: 18_000 },
    water_heater_year: { years: 11, label: 'Chauffe-eau', cost: 1_400 },
    windows_year: { years: 30, label: 'Fenêtres', cost: 20_000 },
};

router.get('/overview', async (req: AuthRequest, res) => {
    try {
        const profile = await loadProfile(req.userId!);
        const month = new Date().getUTCMonth() + 1;
        const season = seasonForMonth(month);

        const tasksRes = await query(
            `SELECT t.*, e.name AS equipment_name
             FROM house_care_tasks t
             LEFT JOIN house_equipments e ON t.equipment_id = e.id
             WHERE t.user_id = $1 AND t.is_active = true
             ORDER BY t.next_due_on ASC NULLS LAST`,
            [req.userId],
        );
        const tasks = tasksRes.rows;

        // Weekly tour: which of the recurring checks have already been ticked
        // since Monday. date_trunc('week') is ISO (Monday-based) in Postgres.
        const weekLogs = await query(
            `SELECT DISTINCT task_id FROM house_care_logs
             WHERE user_id = $1 AND done_on >= date_trunc('week', CURRENT_DATE)::date`,
            [req.userId],
        );
        const doneThisWeek = new Set(weekLogs.rows.map((r: any) => r.task_id as string));

        const iso = today();
        const weekly = tasks
            .filter((t: any) => t.frequency === 'Hebdomadaire' && isInSeason(t, month))
            .map((t: any) => ({ ...mapCareTask(t), done_this_week: doneThisWeek.has(t.id) }));

        const scheduled = tasks.filter((t: any) => t.frequency !== 'Hebdomadaire');
        const overdue = scheduled.filter((t: any) => t.next_due_on && t.next_due_on < iso);
        const dueSoon = scheduled.filter(
            (t: any) =>
                t.next_due_on &&
                t.next_due_on >= iso &&
                t.next_due_on <= new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        );
        const seasonTasks = scheduled.filter((t: any) => isInSeason(t, month));

        // Big-ticket horizon: turn install years into "how long you have left"
        // and a yearly provision. This is the number that stops a $18k roof
        // from being a surprise.
        const currentYear = new Date().getUTCFullYear();
        const bigTicket: Array<{
            key: string;
            label: string;
            installed_year: number;
            expected_year: number;
            years_left: number;
            estimated_cost: number;
            yearly_provision: number;
        }> = [];
        for (const [key, spec] of Object.entries(LIFESPAN_YEARS)) {
            const installed = (profile as any)[key] as number | null;
            if (!installed) continue;
            const expected = installed + spec.years;
            const yearsLeft = expected - currentYear;
            bigTicket.push({
                key,
                label: spec.label,
                installed_year: installed,
                expected_year: expected,
                years_left: yearsLeft,
                estimated_cost: spec.cost,
                yearly_provision: Math.round(spec.cost / Math.max(1, yearsLeft)),
            });
        }
        bigTicket.sort((a, b) => a.years_left - b.years_left);

        // 1-3 % of property value per year is the widely used provisioning rule;
        // we lean to the high end for older houses because that's where the
        // deferred-maintenance backlog lives.
        const value = profile.property_value;
        const rate = profile.build_year && currentYear - profile.build_year > 25 ? 0.02 : 0.015;
        const suggestedBudget = value ? Math.round(value * rate) : null;

        const recentIssues = await query(
            `SELECT l.*, t.title AS task_title, t.category AS task_category
             FROM house_care_logs l
             JOIN house_care_tasks t ON l.task_id = t.id
             WHERE l.user_id = $1 AND l.status = 'Problème'
             ORDER BY l.done_on DESC LIMIT 5`,
            [req.userId],
        );

        res.json({
            success: true,
            data: {
                season,
                month,
                profile,
                weekly_checklist: weekly,
                overdue: overdue.map(mapCareTask),
                due_soon: dueSoon.map(mapCareTask),
                season_tasks: seasonTasks.map(mapCareTask),
                recent_issues: recentIssues.rows.map(mapCareLog),
                big_ticket: bigTicket,
                suggested_yearly_budget: suggestedBudget,
                counts: {
                    total: tasks.length,
                    weekly: weekly.length,
                    weekly_done: weekly.filter((t: any) => t.done_this_week).length,
                    overdue: overdue.length,
                    overdue_critical: overdue.filter((t: any) => t.priority === 'Critique').length,
                    due_soon: dueSoon.length,
                    season: seasonTasks.length,
                },
            },
        });
    } catch (error) {
        logger.error('houseCare.overview_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
