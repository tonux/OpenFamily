import { Router } from 'express';
import { getClient, query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import logger from '../lib/logger';

const router = Router();
router.use(authMiddleware);

// =============================================================================
// IMPORT SAFETY — Whitelist of columns that can be imported per table.
//
// Rationale: the import endpoint historically took the JSON keys provided by the
// client and interpolated them directly into the INSERT column list. Any key
// containing a double-quote could break out of the identifier quoting and
// inject arbitrary SQL (e.g. "id\"); DROP TABLE users; --"). It also allowed
// writing to columns the client should not control (mass-assignment).
//
// The whitelist below is the single source of truth for which columns the
// import accepts. Anything else in the payload is silently dropped. The SQL
// is built from this constant — never from user input. `user_id` is always
// injected server-side from the authenticated request.
// =============================================================================
const IMPORT_TABLES = [
    'family_members',
    'recipes',
    'tasks',
    'budget_entries',
    'budget_limits',
    'shopping_items',
    'appointments',
    'schedule_entries',
    'meal_plans',
] as const;

type ImportTable = (typeof IMPORT_TABLES)[number];

const ALLOWED_COLUMNS: Record<ImportTable, readonly string[]> = {
    family_members: [
        'id',
        'name',
        'role',
        'birth_date',
        'color',
        'blood_type',
        'allergies',
        'medications',
        'vaccines',
        'emergency_contact_name',
        'emergency_contact_phone',
        'emergency_contact',
        'notes',
        'medical_notes',
        'avatar_url',
        'created_at',
        'updated_at',
    ],
    recipes: [
        'id',
        'name',
        'category',
        'description',
        'ingredients',
        'instructions',
        'prep_time',
        'cook_time',
        'servings',
        'difficulty',
        'tags',
        'image_url',
        'created_at',
        'updated_at',
    ],
    tasks: [
        'id',
        'title',
        'description',
        'is_completed',
        'due_date',
        'frequency',
        'priority',
        'assigned_to',
        'completed_at',
        'created_at',
        'updated_at',
    ],
    budget_entries: [
        'id',
        'category',
        'amount',
        'description',
        'date',
        'is_expense',
        'assigned_to',
        'created_at',
        'updated_at',
    ],
    budget_limits: ['id', 'category', 'monthly_limit', 'month', 'year', 'created_at', 'updated_at'],
    shopping_items: [
        'id',
        'name',
        'category',
        'quantity',
        'unit',
        'price',
        'is_checked',
        'notes',
        'created_at',
        'updated_at',
    ],
    appointments: [
        'id',
        'title',
        'description',
        'start_time',
        'end_time',
        'location',
        'family_member_ids',
        'reminder_30min',
        'reminder_1hour',
        'notes',
        'created_at',
        'updated_at',
    ],
    schedule_entries: [
        'id',
        'family_member_id',
        'schedule_type',
        'title',
        'day_of_week',
        'start_time',
        'end_time',
        'specific_date',
        'location',
        'notes',
        'created_at',
        'updated_at',
    ],
    meal_plans: [
        'id',
        'date',
        'meal_type',
        'recipe_id',
        'custom_meal',
        'notes',
        'created_at',
        'updated_at',
    ],
};

// Columns expected to contain UUIDs. Any value provided for these is rejected
// if it doesn't match the canonical UUID v1-v5 format. This avoids 500 errors
// from PostgreSQL when the client sends garbage, and blocks attempts to abuse
// id columns with crafted strings.
const UUID_COLUMNS = new Set(['id', 'family_member_id', 'recipe_id', 'assigned_to']);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// DoS protection: bound the volume of data accepted per request.
const MAX_ROWS_PER_TABLE = 10_000;
const MAX_TOTAL_ROWS = 50_000;

// Export all user data
router.get('/export', async (req: AuthRequest, res) => {
    try {
        const userId = req.userId!;

        const [
            familyMembers,
            tasks,
            recipes,
            mealPlans,
            budgetEntries,
            budgetLimits,
            shoppingItems,
            appointments,
            scheduleEntries,
        ] = await Promise.all([
            query('SELECT * FROM family_members WHERE user_id = $1', [userId]),
            query('SELECT * FROM tasks WHERE user_id = $1', [userId]),
            query('SELECT * FROM recipes WHERE user_id = $1', [userId]),
            query('SELECT * FROM meal_plans WHERE user_id = $1', [userId]),
            query('SELECT * FROM budget_entries WHERE user_id = $1', [userId]),
            query('SELECT * FROM budget_limits WHERE user_id = $1', [userId]),
            query('SELECT * FROM shopping_items WHERE user_id = $1', [userId]),
            query('SELECT * FROM appointments WHERE user_id = $1', [userId]),
            query('SELECT * FROM schedule_entries WHERE user_id = $1', [userId]),
        ]);

        const exportData = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            family_members: familyMembers.rows,
            tasks: tasks.rows,
            recipes: recipes.rows,
            meal_plans: mealPlans.rows,
            budget_entries: budgetEntries.rows,
            budget_limits: budgetLimits.rows,
            shopping_items: shoppingItems.rows,
            appointments: appointments.rows,
            schedule_entries: scheduleEntries.rows,
        };

        res.json({ success: true, data: exportData });
    } catch (error) {
        logger.error('data_transfer.export_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Import user data
router.post('/import', async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const importData = req.body;

    if (!importData || typeof importData !== 'object' || Array.isArray(importData)) {
        return res.status(400).json({ success: false, error: 'Invalid import data format' });
    }

    // Up-front size validation across all tables — fail fast before opening
    // a DB transaction.
    let totalRows = 0;
    for (const table of IMPORT_TABLES) {
        const rows = (importData as Record<string, unknown>)[table];
        if (rows === undefined || rows === null) continue;
        if (!Array.isArray(rows)) {
            return res
                .status(400)
                .json({ success: false, error: `Field "${table}" must be an array` });
        }
        if (rows.length > MAX_ROWS_PER_TABLE) {
            return res.status(413).json({
                success: false,
                error: `Too many rows for "${table}" (max ${MAX_ROWS_PER_TABLE})`,
            });
        }
        totalRows += rows.length;
        if (totalRows > MAX_TOTAL_ROWS) {
            return res.status(413).json({
                success: false,
                error: `Import payload too large (max ${MAX_TOTAL_ROWS} rows total)`,
            });
        }
    }

    const client = await getClient();
    const counts: Record<string, number> = {};

    const importRows = async (table: ImportTable, rawRows: unknown) => {
        if (!Array.isArray(rawRows) || rawRows.length === 0) return;

        const allowed = ALLOWED_COLUMNS[table];
        // `allowed` is a static constant defined in this file — safe to interpolate.
        // We never use a column name that came from the request body.
        let count = 0;

        for (const rawRow of rawRows) {
            if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
                // Silently skip non-object rows. We don't want a single bad
                // entry to fail an otherwise valid import.
                continue;
            }
            const row = rawRow as Record<string, unknown>;

            // Build the column list from the whitelist, keeping only columns
            // that the client actually provided a value for. `user_id` is
            // always forced from the authenticated session and is NOT in the
            // whitelist, so it can never be overridden by client input.
            const cols: string[] = ['user_id'];
            const values: unknown[] = [userId];
            let badUuid = false;

            for (const col of allowed) {
                if (!Object.prototype.hasOwnProperty.call(row, col)) continue;
                const value = row[col];
                if (value === undefined) continue;

                if (UUID_COLUMNS.has(col) && value !== null) {
                    if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
                        badUuid = true;
                        break;
                    }
                }

                cols.push(col);
                values.push(value);
            }

            if (badUuid) continue; // skip malformed row

            // Need at least user_id + one real column to attempt an insert.
            if (cols.length < 2) continue;

            const placeholders = cols.map((_, i) => `$${i + 1}`);
            const sql =
                `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')})` +
                ` VALUES (${placeholders.join(', ')})` +
                ` ON CONFLICT DO NOTHING`;

            const result = await client.query(sql, values);
            count += result.rowCount ?? 0;
        }
        counts[table] = count;
    };

    try {
        await client.query('BEGIN');

        // Import in order respecting foreign key constraints:
        // family_members and recipes must come before tables that reference them
        await importRows('family_members', importData.family_members);
        await importRows('recipes', importData.recipes);
        await importRows('tasks', importData.tasks);
        await importRows('budget_entries', importData.budget_entries);
        await importRows('budget_limits', importData.budget_limits);
        await importRows('shopping_items', importData.shopping_items);
        await importRows('appointments', importData.appointments);
        await importRows('schedule_entries', importData.schedule_entries);
        await importRows('meal_plans', importData.meal_plans);

        await client.query('COMMIT');
        res.json({ success: true, data: { imported: counts } });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('data_transfer.import_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Import failed. No data was modified.' });
    } finally {
        client.release();
    }
});

export default router;
