import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { schoolBreakBodySchema, schoolBreakPatchSchema } from '../schemas/schoolBreaks';
import { toDateKeyLoose } from '../lib/dayContext';
import logger from '../lib/logger';

// =============================================================================
// /api/school-breaks — the periods the kids are home instead of at school.
//
// Small CRUD; the interesting part is what consumes it: lib/dayContext.ts reads
// these rows to decide whether the dashboard shows a school outfit or
// screen-free activity ideas. A user who declares nothing still gets the
// built-in July/August fallback, so this resource is a refinement, never a
// prerequisite.
//
// Rows may overlap — the resolver only asks "is this date covered by any row?".
// =============================================================================

const router = Router();
router.use(authMiddleware);

interface SchoolBreakRow {
    id: string;
    label: string;
    start_date: unknown;
    end_date: unknown;
    created_at: unknown;
    updated_at: unknown;
}

/**
 * pg maps DATE to a JS Date at local midnight, which JSON-serializes to a UTC
 * instant and can slide a day backwards for the client. Send plain YYYY-MM-DD.
 */
const serialize = (r: SchoolBreakRow) => ({
    id: r.id,
    label: r.label,
    start_date: toDateKeyLoose(r.start_date),
    end_date: toDateKeyLoose(r.end_date),
});

router.get('/', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            `SELECT id, label, start_date, end_date, created_at, updated_at
             FROM school_breaks
             WHERE user_id = $1
             ORDER BY start_date ASC`,
            [req.userId],
        );
        res.json({ success: true, data: (result.rows as SchoolBreakRow[]).map(serialize) });
    } catch (error) {
        logger.error('school_breaks.list_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/', validate({ body: schoolBreakBodySchema }), async (req: AuthRequest, res) => {
    try {
        const { label, start_date, end_date } = req.body;
        const result = await query(
            `INSERT INTO school_breaks (user_id, label, start_date, end_date)
             VALUES ($1, $2, $3, $4)
             RETURNING id, label, start_date, end_date, created_at, updated_at`,
            [req.userId, label, start_date, end_date],
        );
        res.status(201).json({
            success: true,
            data: serialize(result.rows[0] as SchoolBreakRow),
        });
    } catch (error) {
        logger.error('school_breaks.create_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.patch('/:id', validate({ body: schoolBreakPatchSchema }), async (req: AuthRequest, res) => {
    try {
        const existing = await query(
            'SELECT start_date, end_date FROM school_breaks WHERE id = $1 AND user_id = $2',
            [req.params.id, req.userId],
        );
        if (existing.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Not found' });
        }

        const current = existing.rows[0] as SchoolBreakRow;
        const start = req.body.start_date ?? toDateKeyLoose(current.start_date);
        const end = req.body.end_date ?? toDateKeyLoose(current.end_date);
        // A one-sided patch can still invert the range against the stored bound;
        // the zod schema can't see that, so it's checked here.
        if (start && end && start > end) {
            return res.status(400).json({
                success: false,
                error: 'end_date must be on or after start_date',
            });
        }

        const updates: string[] = [];
        const values: unknown[] = [];
        for (const col of ['label', 'start_date', 'end_date'] as const) {
            if (req.body[col] === undefined) continue;
            values.push(req.body[col]);
            updates.push(`${col} = $${values.length}`);
        }
        values.push(req.params.id, req.userId);

        const result = await query(
            `UPDATE school_breaks SET ${updates.join(', ')}
             WHERE id = $${values.length - 1} AND user_id = $${values.length}
             RETURNING id, label, start_date, end_date, created_at, updated_at`,
            values,
        );
        res.json({ success: true, data: serialize(result.rows[0] as SchoolBreakRow) });
    } catch (error) {
        logger.error('school_breaks.update_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.delete('/:id', async (req: AuthRequest, res) => {
    try {
        const result = await query('DELETE FROM school_breaks WHERE id = $1 AND user_id = $2', [
            req.params.id,
            req.userId,
        ]);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Not found' });
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('school_breaks.delete_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
