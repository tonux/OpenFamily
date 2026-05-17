import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { toNullIfEmpty, toOptionalNumber, parseStringArray } from '../lib/normalize';
import logger from '../lib/logger';

const router = Router();
router.use(authMiddleware);

const ACCOMMODATION_TYPES = new Set(['airbnb', 'chalet', 'hotel', 'camping', 'family', 'other']);

const STATUSES = new Set(['planning', 'upcoming', 'ongoing', 'past', 'cancelled']);

const LUGGAGE_CATEGORIES = new Set([
    'clothing',
    'toiletries',
    'documents',
    'health',
    'electronics',
    'kids',
    'misc',
]);

const toNumber = (value: unknown): number | undefined => {
    if (value === null || value === undefined) return undefined;
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(n) ? n : undefined;
};

const mapVacation = (row: any) => ({
    ...row,
    budget_planned: toNumber(row.budget_planned),
    actual_cost: toNumber(row.actual_cost),
    rating: row.rating === null || row.rating === undefined ? undefined : Number(row.rating),
    objectives: Array.isArray(row.objectives) ? row.objectives : [],
});

const mapItineraryDay = (row: any) => ({
    ...row,
    activities: Array.isArray(row.activities) ? row.activities : [],
    meals_suggestions: Array.isArray(row.meals_suggestions) ? row.meals_suggestions : [],
    estimated_cost: toNumber(row.estimated_cost),
    day_number: Number(row.day_number),
});

const mapLuggageItem = (row: any) => ({
    ...row,
    quantity: Number(row.quantity),
    packed: Boolean(row.packed),
});

// Derive a sensible status from dates if the caller didn't provide one.
// We never auto-overwrite a "cancelled" status — that one is intentional.
const deriveStatus = (
    start: string | Date,
    end: string | Date,
    fallback: string = 'planning',
): string => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const s = new Date(start);
    const e = new Date(end);
    if (today < s) {
        const diffDays = (s.getTime() - today.getTime()) / 86400000;
        return diffDays <= 30 ? 'upcoming' : fallback;
    }
    if (today > e) return 'past';
    return 'ongoing';
};

const fetchVacationFull = async (vacationId: string, userId: string) => {
    const vacationRes = await query('SELECT * FROM vacations WHERE id = $1 AND user_id = $2', [
        vacationId,
        userId,
    ]);
    if (vacationRes.rows.length === 0) return null;

    const [participantsRes, itineraryRes, luggageRes] = await Promise.all([
        query(
            `SELECT fm.id, fm.name, fm.color
             FROM vacation_participants vp
             INNER JOIN family_members fm ON vp.family_member_id = fm.id
             WHERE vp.vacation_id = $1
             ORDER BY fm.name`,
            [vacationId],
        ),
        query('SELECT * FROM vacation_itinerary WHERE vacation_id = $1 ORDER BY day_number ASC', [
            vacationId,
        ]),
        query(
            `SELECT vl.*, fm.name as family_member_name, fm.color as family_member_color
             FROM vacation_luggage vl
             LEFT JOIN family_members fm ON vl.family_member_id = fm.id
             WHERE vl.vacation_id = $1
             ORDER BY vl.family_member_id NULLS FIRST, vl.category, vl.item`,
            [vacationId],
        ),
    ]);

    return {
        ...mapVacation(vacationRes.rows[0]),
        participants: participantsRes.rows,
        itinerary: itineraryRes.rows.map(mapItineraryDay),
        luggage: luggageRes.rows.map(mapLuggageItem),
    };
};

// List vacations (light: no nested itinerary/luggage)
router.get('/', async (req: AuthRequest, res) => {
    try {
        const { status, year } = req.query;
        const params: any[] = [req.userId];
        let queryText = `SELECT v.*,
            COALESCE(
                (SELECT json_agg(json_build_object('id', fm.id, 'name', fm.name, 'color', fm.color))
                 FROM vacation_participants vp
                 INNER JOIN family_members fm ON vp.family_member_id = fm.id
                 WHERE vp.vacation_id = v.id),
                '[]'::json
            ) as participants
            FROM vacations v WHERE v.user_id = $1`;

        if (status && typeof status === 'string' && STATUSES.has(status)) {
            params.push(status);
            queryText += ` AND v.status = $${params.length}`;
        }
        if (year) {
            params.push(year);
            queryText += ` AND EXTRACT(YEAR FROM v.start_date) = $${params.length}`;
        }
        queryText += ' ORDER BY v.start_date DESC';

        const result = await query(queryText, params);
        res.json({
            success: true,
            data: result.rows.map((row) => ({
                ...mapVacation(row),
                participants: Array.isArray(row.participants) ? row.participants : [],
            })),
        });
    } catch (error) {
        logger.error('vacations.list_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Get a single vacation with itinerary, luggage and participants
router.get('/:id', async (req: AuthRequest, res) => {
    try {
        const data = await fetchVacationFull(req.params.id, req.userId!);
        if (!data) {
            return res.status(404).json({ success: false, error: 'Vacation not found' });
        }
        res.json({ success: true, data });
    } catch (error) {
        logger.error('vacations.get_failed', {
            error: error instanceof Error ? error.message : String(error),
            id: req.params.id,
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Create vacation
router.post('/', async (req: AuthRequest, res) => {
    try {
        const {
            title,
            destination,
            country,
            start_date,
            end_date,
            status,
            accommodation_type,
            accommodation_name,
            accommodation_url,
            accommodation_address,
            accommodation_contact,
            budget_planned,
            objectives,
            notes,
            participants,
        } = req.body;

        if (!title || !destination || !start_date || !end_date) {
            return res.status(400).json({
                success: false,
                error: 'title, destination, start_date and end_date are required',
            });
        }

        if (new Date(end_date) < new Date(start_date)) {
            return res
                .status(400)
                .json({ success: false, error: 'end_date must be on or after start_date' });
        }

        const accType =
            accommodation_type && ACCOMMODATION_TYPES.has(accommodation_type)
                ? accommodation_type
                : null;
        const finalStatus =
            status && STATUSES.has(status) ? status : deriveStatus(start_date, end_date);

        const inserted = await query(
            `INSERT INTO vacations (
                user_id, title, destination, country, start_date, end_date, status,
                accommodation_type, accommodation_name, accommodation_url,
                accommodation_address, accommodation_contact, budget_planned, objectives, notes
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
            [
                req.userId,
                String(title).trim(),
                String(destination).trim(),
                toNullIfEmpty(country),
                start_date,
                end_date,
                finalStatus,
                accType,
                toNullIfEmpty(accommodation_name),
                toNullIfEmpty(accommodation_url),
                toNullIfEmpty(accommodation_address),
                toNullIfEmpty(accommodation_contact),
                toOptionalNumber(budget_planned),
                parseStringArray(objectives),
                toNullIfEmpty(notes),
            ],
        );

        const vacationId = inserted.rows[0].id;

        // Wire participants if provided
        const participantIds = parseStringArray(participants);
        if (participantIds.length > 0) {
            // Filter to members owned by this user to prevent cross-account inserts.
            const owned = await query(
                `SELECT id FROM family_members WHERE user_id = $1 AND id = ANY($2::uuid[])`,
                [req.userId, participantIds],
            );
            for (const row of owned.rows) {
                await query(
                    `INSERT INTO vacation_participants (vacation_id, family_member_id)
                     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [vacationId, row.id],
                );
            }
        }

        const full = await fetchVacationFull(vacationId, req.userId!);
        res.json({ success: true, data: full });
    } catch (error) {
        logger.error('vacations.create_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Update vacation
router.put('/:id', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const {
            title,
            destination,
            country,
            start_date,
            end_date,
            status,
            accommodation_type,
            accommodation_name,
            accommodation_url,
            accommodation_address,
            accommodation_contact,
            budget_planned,
            actual_cost,
            objectives,
            notes,
            rating,
            review_text,
        } = req.body;

        const accType =
            accommodation_type === null
                ? null
                : accommodation_type && ACCOMMODATION_TYPES.has(accommodation_type)
                  ? accommodation_type
                  : undefined;

        const finalStatus = status && STATUSES.has(status) ? status : undefined;

        const ratingValue = toOptionalNumber(rating);
        if (rating !== undefined && rating !== null && rating !== '' && ratingValue === null) {
            return res.status(400).json({ success: false, error: 'Invalid rating' });
        }
        if (ratingValue !== null && (ratingValue < 1 || ratingValue > 5)) {
            return res
                .status(400)
                .json({ success: false, error: 'rating must be between 1 and 5' });
        }

        const result = await query(
            `UPDATE vacations SET
                title = COALESCE($1, title),
                destination = COALESCE($2, destination),
                country = COALESCE($3, country),
                start_date = COALESCE($4, start_date),
                end_date = COALESCE($5, end_date),
                status = COALESCE($6, status),
                accommodation_type = CASE WHEN $7::text = '__keep__' THEN accommodation_type ELSE NULLIF($7, '__null__')::text END,
                accommodation_name = COALESCE($8, accommodation_name),
                accommodation_url = COALESCE($9, accommodation_url),
                accommodation_address = COALESCE($10, accommodation_address),
                accommodation_contact = COALESCE($11, accommodation_contact),
                budget_planned = COALESCE($12, budget_planned),
                actual_cost = COALESCE($13, actual_cost),
                objectives = COALESCE($14, objectives),
                notes = COALESCE($15, notes),
                rating = COALESCE($16, rating),
                review_text = COALESCE($17, review_text)
            WHERE id = $18 AND user_id = $19 RETURNING id`,
            [
                toNullIfEmpty(title),
                toNullIfEmpty(destination),
                country === undefined ? null : toNullIfEmpty(country),
                toNullIfEmpty(start_date),
                toNullIfEmpty(end_date),
                finalStatus ?? null,
                accType === undefined ? '__keep__' : accType === null ? '__null__' : accType,
                accommodation_name === undefined ? null : toNullIfEmpty(accommodation_name),
                accommodation_url === undefined ? null : toNullIfEmpty(accommodation_url),
                accommodation_address === undefined ? null : toNullIfEmpty(accommodation_address),
                accommodation_contact === undefined ? null : toNullIfEmpty(accommodation_contact),
                budget_planned === undefined ? null : toOptionalNumber(budget_planned),
                actual_cost === undefined ? null : toOptionalNumber(actual_cost),
                objectives === undefined ? null : parseStringArray(objectives),
                notes === undefined ? null : toNullIfEmpty(notes),
                ratingValue,
                review_text === undefined ? null : toNullIfEmpty(review_text),
                id,
                req.userId,
            ],
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Vacation not found' });
        }

        const full = await fetchVacationFull(id, req.userId!);
        res.json({ success: true, data: full });
    } catch (error) {
        logger.error('vacations.update_failed', {
            error: error instanceof Error ? error.message : String(error),
            id: req.params.id,
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Delete vacation
router.delete('/:id', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            'DELETE FROM vacations WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Vacation not found' });
        }
        res.json({ success: true, message: 'Vacation deleted' });
    } catch (error) {
        logger.error('vacations.delete_failed', {
            error: error instanceof Error ? error.message : String(error),
            id: req.params.id,
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Replace participants list
router.put('/:id/participants', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const ids = parseStringArray(req.body?.family_member_ids);

        const owns = await query('SELECT id FROM vacations WHERE id = $1 AND user_id = $2', [
            id,
            req.userId,
        ]);
        if (owns.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Vacation not found' });
        }

        const owned = ids.length
            ? await query(
                  `SELECT id FROM family_members WHERE user_id = $1 AND id = ANY($2::uuid[])`,
                  [req.userId, ids],
              )
            : { rows: [] as { id: string }[] };

        await query('DELETE FROM vacation_participants WHERE vacation_id = $1', [id]);
        for (const row of owned.rows) {
            await query(
                `INSERT INTO vacation_participants (vacation_id, family_member_id) VALUES ($1, $2)`,
                [id, row.id],
            );
        }

        const refreshed = await query(
            `SELECT fm.id, fm.name, fm.color
             FROM vacation_participants vp
             INNER JOIN family_members fm ON vp.family_member_id = fm.id
             WHERE vp.vacation_id = $1
             ORDER BY fm.name`,
            [id],
        );
        res.json({ success: true, data: refreshed.rows });
    } catch (error) {
        logger.error('vacations.participants_replace_failed', {
            error: error instanceof Error ? error.message : String(error),
            id: req.params.id,
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// --- Luggage ---

const ensureVacationOwned = async (vacationId: string, userId: string): Promise<boolean> => {
    const result = await query('SELECT id FROM vacations WHERE id = $1 AND user_id = $2', [
        vacationId,
        userId,
    ]);
    return result.rows.length > 0;
};

router.post('/:id/luggage', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const { family_member_id, category, item, quantity, notes } = req.body;

        if (!item || !String(item).trim()) {
            return res.status(400).json({ success: false, error: 'item is required' });
        }
        if (!(await ensureVacationOwned(id, req.userId!))) {
            return res.status(404).json({ success: false, error: 'Vacation not found' });
        }

        const memberId = toNullIfEmpty(family_member_id);
        if (memberId) {
            const owned = await query(
                'SELECT id FROM family_members WHERE id = $1 AND user_id = $2',
                [memberId, req.userId],
            );
            if (owned.rows.length === 0) {
                return res.status(400).json({ success: false, error: 'Invalid family_member_id' });
            }
        }

        const cat = category && LUGGAGE_CATEGORIES.has(category) ? category : 'misc';
        const qty = Math.max(1, Math.floor(toOptionalNumber(quantity) ?? 1));

        const inserted = await query(
            `INSERT INTO vacation_luggage (vacation_id, family_member_id, category, item, quantity, notes)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [id, memberId, cat, String(item).trim(), qty, toNullIfEmpty(notes)],
        );

        const full = await query(
            `SELECT vl.*, fm.name as family_member_name, fm.color as family_member_color
             FROM vacation_luggage vl
             LEFT JOIN family_members fm ON vl.family_member_id = fm.id
             WHERE vl.id = $1`,
            [inserted.rows[0].id],
        );
        res.json({ success: true, data: mapLuggageItem(full.rows[0]) });
    } catch (error) {
        logger.error('vacations.luggage_create_failed', {
            error: error instanceof Error ? error.message : String(error),
            id: req.params.id,
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.patch('/:id/luggage/:itemId', async (req: AuthRequest, res) => {
    try {
        const { id, itemId } = req.params;
        const { packed, item, quantity, category, notes, family_member_id } = req.body;

        if (!(await ensureVacationOwned(id, req.userId!))) {
            return res.status(404).json({ success: false, error: 'Vacation not found' });
        }

        const cat =
            category === undefined
                ? undefined
                : category && LUGGAGE_CATEGORIES.has(category)
                  ? category
                  : 'misc';

        let memberValue: string | null | undefined = undefined;
        if (family_member_id !== undefined) {
            memberValue = toNullIfEmpty(family_member_id);
            if (memberValue) {
                const owned = await query(
                    'SELECT id FROM family_members WHERE id = $1 AND user_id = $2',
                    [memberValue, req.userId],
                );
                if (owned.rows.length === 0) {
                    return res
                        .status(400)
                        .json({ success: false, error: 'Invalid family_member_id' });
                }
            }
        }

        const result = await query(
            `UPDATE vacation_luggage SET
                packed = COALESCE($1, packed),
                item = COALESCE($2, item),
                quantity = COALESCE($3, quantity),
                category = COALESCE($4, category),
                notes = COALESCE($5, notes),
                family_member_id = CASE WHEN $6::text = '__keep__' THEN family_member_id
                                        WHEN $6::text = '__null__' THEN NULL
                                        ELSE $6::uuid END
            WHERE id = $7 AND vacation_id = $8 RETURNING id`,
            [
                packed === undefined ? null : Boolean(packed),
                toNullIfEmpty(item),
                quantity === undefined
                    ? null
                    : Math.max(1, Math.floor(toOptionalNumber(quantity) ?? 1)),
                cat ?? null,
                notes === undefined ? null : toNullIfEmpty(notes),
                memberValue === undefined
                    ? '__keep__'
                    : memberValue === null
                      ? '__null__'
                      : memberValue,
                itemId,
                id,
            ],
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Luggage item not found' });
        }

        const full = await query(
            `SELECT vl.*, fm.name as family_member_name, fm.color as family_member_color
             FROM vacation_luggage vl
             LEFT JOIN family_members fm ON vl.family_member_id = fm.id
             WHERE vl.id = $1`,
            [itemId],
        );
        res.json({ success: true, data: mapLuggageItem(full.rows[0]) });
    } catch (error) {
        logger.error('vacations.luggage_update_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.delete('/:id/luggage/:itemId', async (req: AuthRequest, res) => {
    try {
        const { id, itemId } = req.params;
        if (!(await ensureVacationOwned(id, req.userId!))) {
            return res.status(404).json({ success: false, error: 'Vacation not found' });
        }
        const result = await query(
            'DELETE FROM vacation_luggage WHERE id = $1 AND vacation_id = $2 RETURNING id',
            [itemId, id],
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Luggage item not found' });
        }
        res.json({ success: true, message: 'Luggage item deleted' });
    } catch (error) {
        logger.error('vacations.luggage_delete_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// --- Itinerary (manual CRUD; AI generation comes in PR2) ---

router.post('/:id/itinerary', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const {
            day_number,
            date,
            theme,
            activities,
            meals_suggestions,
            estimated_cost,
            transport_notes,
            notes,
        } = req.body;

        if (!day_number || !date) {
            return res
                .status(400)
                .json({ success: false, error: 'day_number and date are required' });
        }
        if (!(await ensureVacationOwned(id, req.userId!))) {
            return res.status(404).json({ success: false, error: 'Vacation not found' });
        }

        const inserted = await query(
            `INSERT INTO vacation_itinerary
                (vacation_id, day_number, date, theme, activities, meals_suggestions, estimated_cost, transport_notes, notes)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)
             ON CONFLICT (vacation_id, day_number)
             DO UPDATE SET date = EXCLUDED.date, theme = EXCLUDED.theme,
                 activities = EXCLUDED.activities, meals_suggestions = EXCLUDED.meals_suggestions,
                 estimated_cost = EXCLUDED.estimated_cost, transport_notes = EXCLUDED.transport_notes,
                 notes = EXCLUDED.notes
             RETURNING *`,
            [
                id,
                Number(day_number),
                date,
                toNullIfEmpty(theme),
                JSON.stringify(Array.isArray(activities) ? activities : []),
                JSON.stringify(Array.isArray(meals_suggestions) ? meals_suggestions : []),
                toOptionalNumber(estimated_cost),
                toNullIfEmpty(transport_notes),
                toNullIfEmpty(notes),
            ],
        );
        res.json({ success: true, data: mapItineraryDay(inserted.rows[0]) });
    } catch (error) {
        logger.error('vacations.itinerary_upsert_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.delete('/:id/itinerary/:dayId', async (req: AuthRequest, res) => {
    try {
        const { id, dayId } = req.params;
        if (!(await ensureVacationOwned(id, req.userId!))) {
            return res.status(404).json({ success: false, error: 'Vacation not found' });
        }
        const result = await query(
            'DELETE FROM vacation_itinerary WHERE id = $1 AND vacation_id = $2 RETURNING id',
            [dayId, id],
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Itinerary day not found' });
        }
        res.json({ success: true, message: 'Itinerary day deleted' });
    } catch (error) {
        logger.error('vacations.itinerary_delete_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
