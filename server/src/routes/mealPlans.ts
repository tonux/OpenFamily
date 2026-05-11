import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { toNullIfEmpty } from '../lib/normalize';
import logger from '../lib/logger';

const router = Router();
router.use(authMiddleware);

const LUNCHBOX_TYPE = 'Boîte à lunch';
const LUNCHBOX_FIELDS = ['main', 'fruit', 'snack', 'drink'] as const;

const ensureRecipeBelongsToUser = async (recipeId: string | null, userId: string) => {
    if (!recipeId) {
        return;
    }

    const recipe = await query('SELECT id FROM recipes WHERE id = $1 AND user_id = $2', [
        recipeId,
        userId,
    ]);
    if (recipe.rows.length === 0) {
        throw new Error('INVALID_RECIPE');
    }
};

const ensureFamilyMemberBelongsToUser = async (memberId: string | null, userId: string) => {
    if (!memberId) {
        return;
    }

    const result = await query('SELECT id FROM family_members WHERE id = $1 AND user_id = $2', [
        memberId,
        userId,
    ]);
    if (result.rows.length === 0) {
        throw new Error('INVALID_FAMILY_MEMBER');
    }
};

// Keep only the 4 supported keys, drop empty strings, and refuse anything that
// isn't a string. Returns null if every component is empty so we don't store
// `{}` rows that pollute the JSONB column.
const sanitizeLunchboxItems = (raw: unknown): Record<string, string> | null => {
    if (!raw || typeof raw !== 'object') return null;
    const cleaned: Record<string, string> = {};
    for (const key of LUNCHBOX_FIELDS) {
        const value = (raw as Record<string, unknown>)[key];
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.length > 0) cleaned[key] = trimmed;
        }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : null;
};

const mapMealPlanRow = (row: any) => ({
    ...row,
    recipe: row.recipe_id
        ? {
              id: row.recipe_id,
              name: row.recipe_name,
              category: row.recipe_category,
              image_url: row.recipe_image,
          }
        : null,
    family_member: row.family_member_id
        ? {
              id: row.family_member_id,
              name: row.family_member_name,
              color: row.family_member_color,
          }
        : null,
});

const SELECT_FULL = `
    SELECT mp.*,
           r.name as recipe_name,
           r.category as recipe_category,
           r.image_url as recipe_image,
           fm.name as family_member_name,
           fm.color as family_member_color
    FROM meal_plans mp
    LEFT JOIN recipes r ON mp.recipe_id = r.id
    LEFT JOIN family_members fm ON mp.family_member_id = fm.id
`;

// Get meal plans for a date range
router.get('/', async (req: AuthRequest, res) => {
    try {
        const { start_date, end_date } = req.query;

        let queryText = `${SELECT_FULL} WHERE mp.user_id = $1`;
        const params: any[] = [req.userId];

        if (start_date) {
            params.push(start_date);
            queryText += ` AND mp.date >= $${params.length}`;
        }

        if (end_date) {
            params.push(end_date);
            queryText += ` AND mp.date <= $${params.length}`;
        }

        queryText += ' ORDER BY mp.date ASC, mp.meal_type ASC';

        const result = await query(queryText, params);
        res.json({ success: true, data: result.rows.map(mapMealPlanRow) });
    } catch (error) {
        logger.error('meal_plans.get_meal_plans_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Lunchbox history for a specific kid — most recent first.
// Optional ?limit=, default 30.
router.get('/lunchbox/history/:familyMemberId', async (req: AuthRequest, res) => {
    try {
        const { familyMemberId } = req.params;
        const limitRaw = Number.parseInt(String(req.query.limit ?? '30'), 10);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 30;

        await ensureFamilyMemberBelongsToUser(familyMemberId, req.userId!);

        const result = await query(
            `${SELECT_FULL}
             WHERE mp.user_id = $1
               AND mp.family_member_id = $2
               AND mp.meal_type = $3
             ORDER BY mp.date DESC
             LIMIT $4`,
            [req.userId, familyMemberId, LUNCHBOX_TYPE, limit],
        );

        res.json({ success: true, data: result.rows.map(mapMealPlanRow) });
    } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_FAMILY_MEMBER') {
            return res.status(400).json({ success: false, error: 'Family member not found' });
        }
        logger.error('meal_plans.lunchbox_history_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Lunchbox frequency stats: count how often each item appears, per component
// type (main/fruit/snack/drink), for a kid in a given window.
// Defaults to the last 60 days.
router.get('/lunchbox/stats/:familyMemberId', async (req: AuthRequest, res) => {
    try {
        const { familyMemberId } = req.params;
        const startParam = toNullIfEmpty(req.query.start_date) as string | null;
        const endParam = toNullIfEmpty(req.query.end_date) as string | null;

        await ensureFamilyMemberBelongsToUser(familyMemberId, req.userId!);

        const params: any[] = [req.userId, familyMemberId, LUNCHBOX_TYPE];
        let where = `WHERE mp.user_id = $1
                       AND mp.family_member_id = $2
                       AND mp.meal_type = $3
                       AND mp.lunchbox_items IS NOT NULL`;

        if (startParam) {
            params.push(startParam);
            where += ` AND mp.date >= $${params.length}`;
        }
        if (endParam) {
            params.push(endParam);
            where += ` AND mp.date <= $${params.length}`;
        }

        const result = await query(
            `SELECT mp.lunchbox_items, mp.date FROM meal_plans mp ${where}`,
            params,
        );

        // Aggregate in JS — the dataset is small (kids' lunches over a few
        // weeks) and Postgres jsonb_each + group-by would obscure intent.
        const totalsByField: Record<string, Map<string, number>> = {};
        for (const field of LUNCHBOX_FIELDS) totalsByField[field] = new Map();

        let totalLunchboxes = 0;
        for (const row of result.rows) {
            totalLunchboxes += 1;
            const items = row.lunchbox_items as Record<string, string> | null;
            if (!items) continue;
            for (const field of LUNCHBOX_FIELDS) {
                const value = items[field];
                if (typeof value !== 'string' || !value.trim()) continue;
                // Case-insensitive grouping so "Pomme" and "pomme" merge.
                const key = value.trim().toLowerCase();
                const current = totalsByField[field].get(key) ?? 0;
                totalsByField[field].set(key, current + 1);
            }
        }

        const formatField = (field: string) =>
            Array.from(totalsByField[field].entries())
                .map(([label, count]) => ({ label, count }))
                .sort((a, b) => b.count - a.count);

        res.json({
            success: true,
            data: {
                totalLunchboxes,
                byField: {
                    main: formatField('main'),
                    fruit: formatField('fruit'),
                    snack: formatField('snack'),
                    drink: formatField('drink'),
                },
            },
        });
    } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_FAMILY_MEMBER') {
            return res.status(400).json({ success: false, error: 'Family member not found' });
        }
        logger.error('meal_plans.lunchbox_stats_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Generate shopping items from upcoming lunchboxes in [start_date, end_date].
// Each non-empty component becomes one shopping_items row, deduped by name
// (case-insensitive). Idempotent re-runs add quantities together.
router.post('/lunchbox/shopping-list', async (req: AuthRequest, res) => {
    try {
        const startParam = toNullIfEmpty(req.body?.start_date) as string | null;
        const endParam = toNullIfEmpty(req.body?.end_date) as string | null;

        if (!startParam || !endParam) {
            return res
                .status(400)
                .json({ success: false, error: 'start_date and end_date are required' });
        }

        const result = await query(
            `SELECT lunchbox_items FROM meal_plans
             WHERE user_id = $1 AND meal_type = $2
               AND lunchbox_items IS NOT NULL
               AND date BETWEEN $3 AND $4`,
            [req.userId, LUNCHBOX_TYPE, startParam, endParam],
        );

        // Aggregate occurrences per item name, remembering which component it
        // came from (used to map to a shopping category).
        const tally = new Map<string, { count: number; field: string; original: string }>();
        for (const row of result.rows) {
            const items = row.lunchbox_items as Record<string, string> | null;
            if (!items) continue;
            for (const field of LUNCHBOX_FIELDS) {
                const value = items[field];
                if (typeof value !== 'string' || !value.trim()) continue;
                const original = value.trim();
                const key = original.toLowerCase();
                const existing = tally.get(key);
                if (existing) {
                    existing.count += 1;
                } else {
                    tally.set(key, { count: 1, field, original });
                }
            }
        }

        const fieldToCategory: Record<string, string> = {
            main: 'Alimentation',
            fruit: 'Alimentation',
            snack: 'Alimentation',
            drink: 'Alimentation',
        };

        let inserted = 0;
        for (const { count, field, original } of tally.values()) {
            await query(
                `INSERT INTO shopping_items (user_id, name, category, quantity)
                 VALUES ($1, $2, $3, $4)`,
                [req.userId, original, fieldToCategory[field] ?? 'Autre', count],
            );
            inserted += 1;
        }

        res.json({ success: true, data: { inserted, total_lunchboxes: result.rows.length } });
    } catch (error) {
        logger.error('meal_plans.lunchbox_shopping_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Create or update meal plan by unique slot
router.post('/', async (req: AuthRequest, res) => {
    try {
        const { date, meal_type, recipe_id, custom_meal, notes, family_member_id, lunchbox_items } =
            req.body;
        const cleanedDate = toNullIfEmpty(date);
        const cleanedMealType = toNullIfEmpty(meal_type);
        const cleanedRecipeId = toNullIfEmpty(recipe_id) as string | null;
        const cleanedFamilyMemberId = toNullIfEmpty(family_member_id) as string | null;
        const cleanedLunchboxItems = sanitizeLunchboxItems(lunchbox_items);

        if (!cleanedDate || !cleanedMealType) {
            return res
                .status(400)
                .json({ success: false, error: 'date and meal_type are required' });
        }

        // Lunchbox slots MUST target a kid; a parent-level lunchbox makes no
        // sense in the data model and would collide with the household unique
        // index after the migration.
        if (cleanedMealType === LUNCHBOX_TYPE && !cleanedFamilyMemberId) {
            return res
                .status(400)
                .json({ success: false, error: 'Lunchbox requires family_member_id' });
        }

        await ensureRecipeBelongsToUser(cleanedRecipeId, req.userId!);
        await ensureFamilyMemberBelongsToUser(cleanedFamilyMemberId, req.userId!);

        // The two partial unique indexes (household vs per-member) require
        // distinct ON CONFLICT clauses; pick the right one based on whether
        // a family member is attached.
        const conflictTarget = cleanedFamilyMemberId
            ? '(user_id, date, meal_type, family_member_id) WHERE family_member_id IS NOT NULL'
            : '(user_id, date, meal_type) WHERE family_member_id IS NULL';

        const result = await query(
            `INSERT INTO meal_plans
                (user_id, date, meal_type, recipe_id, custom_meal, notes, family_member_id, lunchbox_items)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT ${conflictTarget}
             DO UPDATE SET recipe_id = EXCLUDED.recipe_id,
                           custom_meal = EXCLUDED.custom_meal,
                           notes = EXCLUDED.notes,
                           lunchbox_items = EXCLUDED.lunchbox_items
             RETURNING id`,
            [
                req.userId,
                cleanedDate,
                cleanedMealType,
                cleanedRecipeId,
                toNullIfEmpty(custom_meal),
                toNullIfEmpty(notes),
                cleanedFamilyMemberId,
                cleanedLunchboxItems ? JSON.stringify(cleanedLunchboxItems) : null,
            ],
        );

        const withJoins = await query(`${SELECT_FULL} WHERE mp.id = $1 AND mp.user_id = $2`, [
            result.rows[0].id,
            req.userId,
        ]);

        res.json({ success: true, data: mapMealPlanRow(withJoins.rows[0]) });
    } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_RECIPE') {
            return res.status(400).json({ success: false, error: 'Recipe not found' });
        }
        if (error instanceof Error && error.message === 'INVALID_FAMILY_MEMBER') {
            return res.status(400).json({ success: false, error: 'Family member not found' });
        }

        logger.error('meal_plans.create_meal_plan_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Update meal plan by id
router.put('/:id', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const { date, meal_type, recipe_id, custom_meal, notes, family_member_id, lunchbox_items } =
            req.body;

        const updates: string[] = [];
        const values: any[] = [];

        const pushUpdate = (field: string, value: any) => {
            values.push(value);
            updates.push(`${field} = $${values.length}`);
        };

        if (date !== undefined) {
            const cleanedDate = toNullIfEmpty(date);
            if (!cleanedDate) {
                return res.status(400).json({ success: false, error: 'date cannot be empty' });
            }
            pushUpdate('date', cleanedDate);
        }

        if (meal_type !== undefined) {
            const cleanedMealType = toNullIfEmpty(meal_type);
            if (!cleanedMealType) {
                return res.status(400).json({ success: false, error: 'meal_type cannot be empty' });
            }
            pushUpdate('meal_type', cleanedMealType);
        }

        if (recipe_id !== undefined) {
            const cleanedRecipeId = toNullIfEmpty(recipe_id) as string | null;
            await ensureRecipeBelongsToUser(cleanedRecipeId, req.userId!);
            pushUpdate('recipe_id', cleanedRecipeId);
        }

        if (custom_meal !== undefined) {
            pushUpdate('custom_meal', toNullIfEmpty(custom_meal));
        }

        if (notes !== undefined) {
            pushUpdate('notes', toNullIfEmpty(notes));
        }

        if (family_member_id !== undefined) {
            const cleanedFamilyMemberId = toNullIfEmpty(family_member_id) as string | null;
            await ensureFamilyMemberBelongsToUser(cleanedFamilyMemberId, req.userId!);
            pushUpdate('family_member_id', cleanedFamilyMemberId);
        }

        if (lunchbox_items !== undefined) {
            const cleanedLunchboxItems = sanitizeLunchboxItems(lunchbox_items);
            pushUpdate(
                'lunchbox_items',
                cleanedLunchboxItems ? JSON.stringify(cleanedLunchboxItems) : null,
            );
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        const result = await query(
            `UPDATE meal_plans
       SET ${updates.join(', ')}
       WHERE id = $${values.length + 1} AND user_id = $${values.length + 2}
       RETURNING id`,
            [...values, id, req.userId],
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Meal plan not found' });
        }

        const withJoins = await query(`${SELECT_FULL} WHERE mp.id = $1 AND mp.user_id = $2`, [
            id,
            req.userId,
        ]);

        res.json({ success: true, data: mapMealPlanRow(withJoins.rows[0]) });
    } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_RECIPE') {
            return res.status(400).json({ success: false, error: 'Recipe not found' });
        }
        if (error instanceof Error && error.message === 'INVALID_FAMILY_MEMBER') {
            return res.status(400).json({ success: false, error: 'Family member not found' });
        }

        logger.error('meal_plans.update_meal_plan_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Delete meal plan
router.delete('/:id', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            'DELETE FROM meal_plans WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.userId],
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Meal plan not found' });
        }

        res.json({ success: true, message: 'Meal plan deleted' });
    } catch (error) {
        logger.error('meal_plans.delete_meal_plan_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
