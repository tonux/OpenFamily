import { Router } from 'express';
import { getClient, query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
    eventBodySchema,
    eventListQuerySchema,
    eventPatchSchema,
    gradeBodySchema,
    gradeListQuerySchema,
    gradePatchSchema,
    presetApplySchema,
    statisticsQuerySchema,
    studentBodySchema,
    studentListQuerySchema,
    studentPatchSchema,
    studyPlanSchema,
    studySessionBodySchema,
    studySessionCompleteSchema,
    studySessionListQuerySchema,
    studySessionPatchSchema,
    supplyBodySchema,
    supplyListQuerySchema,
    supplyPatchSchema,
} from '../schemas/school';
import { toDateKeyLoose } from '../lib/dayContext';
import { findPreset, listPresets } from '../lib/schoolPresets';
import logger from '../lib/logger';

// =============================================================================
// /api/school — "École" module
//
// Five resources, all auth-gated and scoped to the calling user:
//   - school_students       — the child's school profile for a school year
//   - school_events         — school calendar (rentrée, pédagogiques, congés…)
//   - school_supplies       — back-to-school shopping checklist
//   - school_study_sessions — the at-home study plan
//   - school_grades         — evaluations, feeding the "what to work on" view
//
// Plus:
//   GET  /statistics              — the page's overview tab, one round-trip
//   GET  /presets                 — ready-made school-year bundles
//   POST /presets/:id/apply       — import a bundle onto a student (idempotent)
//   POST /study-sessions/plan     — generate N weeks from a weekly template
//   PATCH /study-sessions/:id/complete — mark done, roll the recurrence forward
//
// Reminders are NOT sent from here: rows carry reminder_enabled /
// reminder_days_before, and the daily morning pulse in
// lib/notificationsScheduler.ts turns them into notifications (then emails).
// =============================================================================

const router = Router();
router.use(authMiddleware);

// Build a partial UPDATE from a validated patch body. Shared by every PATCH.
const buildUpdate = (body: Record<string, unknown>) => {
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue;
        values.push(v);
        updates.push(`${k} = $${values.length}`);
    }
    return { updates, values };
};

/**
 * Ownership guard for every student_id coming from a request body. Required is
 * the common case (supplies/sessions/grades); events allow a null student.
 */
const ensureStudent = async (
    studentId: string | null | undefined,
    userId: string,
): Promise<void> => {
    if (!studentId) return;
    const r = await query('SELECT id FROM school_students WHERE id = $1 AND user_id = $2', [
        studentId,
        userId,
    ]);
    if (r.rows.length === 0) throw new Error('INVALID_STUDENT');
};

const ensureFamilyMember = async (
    memberId: string | null | undefined,
    userId: string,
): Promise<void> => {
    if (!memberId) return;
    const r = await query('SELECT id FROM family_members WHERE id = $1 AND user_id = $2', [
        memberId,
        userId,
    ]);
    if (r.rows.length === 0) throw new Error('INVALID_MEMBER');
};

const handleFkError = (error: unknown, res: import('express').Response): boolean => {
    if (error instanceof Error && error.message === 'INVALID_STUDENT') {
        res.status(400).json({ success: false, error: 'Student not found' });
        return true;
    }
    if (error instanceof Error && error.message === 'INVALID_MEMBER') {
        res.status(400).json({ success: false, error: 'Family member not found' });
        return true;
    }
    return false;
};

const fail = (res: import('express').Response, event: string, error: unknown) => {
    logger.error(`school.${event}`, {
        error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ success: false, error: 'Internal server error' });
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** pg returns TIME as 'HH:MM:SS'; the client only ever wants 'HH:MM'. */
const toTimeKey = (v: unknown): string | null =>
    typeof v === 'string' && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : null;

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

const mapStudent = (row: any) => ({
    id: row.id as string,
    family_member_id: row.family_member_id ?? null,
    name: row.name as string,
    school_name: row.school_name ?? null,
    grade_level: row.grade_level ?? null,
    school_year: row.school_year as string,
    teacher_name: row.teacher_name ?? null,
    class_name: row.class_name ?? null,
    color: row.color as string,
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

const mapEvent = (row: any) => ({
    id: row.id as string,
    student_id: row.student_id ?? null,
    student_name: row.student_name ?? null,
    title: row.title as string,
    event_type: row.event_type as string,
    start_date: toDateKeyLoose(row.start_date),
    end_date: toDateKeyLoose(row.end_date),
    start_time: toTimeKey(row.start_time),
    location: row.location ?? null,
    notes: row.notes ?? null,
    reminder_enabled: Boolean(row.reminder_enabled),
    reminder_days_before: Number(row.reminder_days_before),
    created_at: row.created_at,
    updated_at: row.updated_at,
});

const mapSupply = (row: any) => ({
    id: row.id as string,
    student_id: row.student_id as string,
    label: row.label as string,
    category: row.category as string,
    quantity: Number(row.quantity),
    isbn: row.isbn ?? null,
    subject: row.subject ?? null,
    store: row.store ?? null,
    unit_price: num(row.unit_price),
    is_purchased: Boolean(row.is_purchased),
    purchased_at: toDateKeyLoose(row.purchased_at),
    notes: row.notes ?? null,
    position: Number(row.position),
    created_at: row.created_at,
    updated_at: row.updated_at,
});

const mapSession = (row: any) => ({
    id: row.id as string,
    student_id: row.student_id as string,
    subject: row.subject as string,
    title: row.title as string,
    scheduled_date: toDateKeyLoose(row.scheduled_date),
    start_time: toTimeKey(row.start_time),
    duration_minutes: Number(row.duration_minutes),
    objective: row.objective ?? null,
    status: row.status as string,
    completed_at: row.completed_at ?? null,
    mastery: row.mastery ?? null,
    recurrence_days: row.recurrence_days ?? null,
    notes: row.notes ?? null,
    reminder_enabled: Boolean(row.reminder_enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
});

const mapGrade = (row: any) => ({
    id: row.id as string,
    student_id: row.student_id as string,
    subject: row.subject as string,
    title: row.title as string,
    evaluated_on: toDateKeyLoose(row.evaluated_on),
    score: Number(row.score),
    max_score: Number(row.max_score),
    percentage: Math.round((Number(row.score) / Number(row.max_score)) * 1000) / 10,
    term: row.term ?? null,
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

router.get(
    '/students',
    validate({ query: studentListQuerySchema }),
    async (req: AuthRequest, res) => {
        try {
            const { school_year } = req.query as { school_year?: string };
            const params: any[] = [req.userId];
            let sql = 'SELECT * FROM school_students WHERE user_id = $1';
            if (school_year) {
                params.push(school_year);
                sql += ` AND school_year = $${params.length}`;
            }
            sql += ' ORDER BY school_year DESC, name ASC';
            const r = await query(sql, params);
            res.json({ success: true, data: r.rows.map(mapStudent) });
        } catch (error) {
            fail(res, 'list_students_failed', error);
        }
    },
);

router.post('/students', validate({ body: studentBodySchema }), async (req: AuthRequest, res) => {
    try {
        const b = req.body;
        await ensureFamilyMember(b.family_member_id, req.userId!);
        const r = await query(
            `INSERT INTO school_students
                (user_id, family_member_id, name, school_name, grade_level, school_year,
                 teacher_name, class_name, color, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'#3B82F6'),$10)
             RETURNING *`,
            [
                req.userId,
                b.family_member_id ?? null,
                b.name,
                b.school_name ?? null,
                b.grade_level ?? null,
                b.school_year,
                b.teacher_name ?? null,
                b.class_name ?? null,
                b.color ?? null,
                b.notes ?? null,
            ],
        );
        res.status(201).json({ success: true, data: mapStudent(r.rows[0]) });
    } catch (error) {
        if (handleFkError(error, res)) return;
        fail(res, 'create_student_failed', error);
    }
});

router.patch(
    '/students/:id',
    validate({ body: studentPatchSchema }),
    async (req: AuthRequest, res) => {
        try {
            await ensureFamilyMember(req.body.family_member_id, req.userId!);
            const { updates, values } = buildUpdate(req.body);
            if (updates.length === 0) {
                return res.status(400).json({ success: false, error: 'No fields to update' });
            }
            values.push(req.params.id, req.userId);
            const r = await query(
                `UPDATE school_students SET ${updates.join(', ')}
                 WHERE id = $${values.length - 1} AND user_id = $${values.length}
                 RETURNING *`,
                values,
            );
            if (r.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Student not found' });
            }
            res.json({ success: true, data: mapStudent(r.rows[0]) });
        } catch (error) {
            if (handleFkError(error, res)) return;
            fail(res, 'update_student_failed', error);
        }
    },
);

router.delete('/students/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            'DELETE FROM school_students WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }
        res.json({ success: true });
    } catch (error) {
        fail(res, 'delete_student_failed', error);
    }
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const SELECT_EVENT_FULL = `
    SELECT e.*, s.name AS student_name
    FROM school_events e
    LEFT JOIN school_students s ON e.student_id = s.id
`;

router.get('/events', validate({ query: eventListQuerySchema }), async (req: AuthRequest, res) => {
    try {
        const { student_id, event_type, from, to, scope } = req.query as {
            student_id?: string;
            event_type?: string;
            from?: string;
            to?: string;
            scope?: 'upcoming' | 'all';
        };
        const params: any[] = [req.userId];
        let sql = `${SELECT_EVENT_FULL} WHERE e.user_id = $1`;
        if (student_id) {
            params.push(student_id);
            sql += ` AND e.student_id = $${params.length}`;
        }
        if (event_type) {
            params.push(event_type);
            sql += ` AND e.event_type = $${params.length}`;
        }
        // A multi-day event overlaps the window as soon as its own range does,
        // so compare against COALESCE(end_date, start_date) on the upper side.
        if (from) {
            params.push(from);
            sql += ` AND COALESCE(e.end_date, e.start_date) >= $${params.length}`;
        }
        if (to) {
            params.push(to);
            sql += ` AND e.start_date <= $${params.length}`;
        }
        if (scope === 'upcoming') {
            sql += ' AND COALESCE(e.end_date, e.start_date) >= CURRENT_DATE';
        }
        sql += ' ORDER BY e.start_date ASC, e.start_time ASC NULLS FIRST';
        const r = await query(sql, params);
        res.json({ success: true, data: r.rows.map(mapEvent) });
    } catch (error) {
        fail(res, 'list_events_failed', error);
    }
});

router.post('/events', validate({ body: eventBodySchema }), async (req: AuthRequest, res) => {
    try {
        const b = req.body;
        await ensureStudent(b.student_id, req.userId!);
        const insert = await query(
            `INSERT INTO school_events
                (user_id, student_id, title, event_type, start_date, end_date, start_time,
                 location, notes, reminder_enabled, reminder_days_before)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,TRUE),COALESCE($11,1))
             RETURNING id`,
            [
                req.userId,
                b.student_id ?? null,
                b.title,
                b.event_type,
                b.start_date,
                b.end_date ?? null,
                b.start_time ?? null,
                b.location ?? null,
                b.notes ?? null,
                b.reminder_enabled ?? null,
                b.reminder_days_before ?? null,
            ],
        );
        const r = await query(`${SELECT_EVENT_FULL} WHERE e.id = $1 AND e.user_id = $2`, [
            insert.rows[0].id,
            req.userId,
        ]);
        res.status(201).json({ success: true, data: mapEvent(r.rows[0]) });
    } catch (error) {
        if (handleFkError(error, res)) return;
        fail(res, 'create_event_failed', error);
    }
});

router.patch('/events/:id', validate({ body: eventPatchSchema }), async (req: AuthRequest, res) => {
    try {
        await ensureStudent(req.body.student_id, req.userId!);
        const { updates, values } = buildUpdate(req.body);
        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }
        values.push(req.params.id, req.userId);
        const upd = await query(
            `UPDATE school_events SET ${updates.join(', ')}
             WHERE id = $${values.length - 1} AND user_id = $${values.length}
             RETURNING id`,
            values,
        );
        if (upd.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Event not found' });
        }
        const r = await query(`${SELECT_EVENT_FULL} WHERE e.id = $1 AND e.user_id = $2`, [
            req.params.id,
            req.userId,
        ]);
        res.json({ success: true, data: mapEvent(r.rows[0]) });
    } catch (error) {
        if (handleFkError(error, res)) return;
        fail(res, 'update_event_failed', error);
    }
});

router.delete('/events/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            'DELETE FROM school_events WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Event not found' });
        }
        res.json({ success: true });
    } catch (error) {
        fail(res, 'delete_event_failed', error);
    }
});

// ---------------------------------------------------------------------------
// Supplies (the back-to-school checklist)
// ---------------------------------------------------------------------------

router.get(
    '/supplies',
    validate({ query: supplyListQuerySchema }),
    async (req: AuthRequest, res) => {
        try {
            const { student_id, category, purchased, q } = req.query as {
                student_id?: string;
                category?: string;
                purchased?: 'true' | 'false';
                q?: string;
            };
            const params: any[] = [req.userId];
            let sql = 'SELECT * FROM school_supplies WHERE user_id = $1';
            if (student_id) {
                params.push(student_id);
                sql += ` AND student_id = $${params.length}`;
            }
            if (category) {
                params.push(category);
                sql += ` AND category = $${params.length}`;
            }
            if (purchased) {
                params.push(purchased === 'true');
                sql += ` AND is_purchased = $${params.length}`;
            }
            if (q) {
                params.push(`%${q}%`);
                sql += ` AND label ILIKE $${params.length}`;
            }
            sql += ' ORDER BY category ASC, position ASC, label ASC';
            const r = await query(sql, params);
            res.json({ success: true, data: r.rows.map(mapSupply) });
        } catch (error) {
            fail(res, 'list_supplies_failed', error);
        }
    },
);

router.post('/supplies', validate({ body: supplyBodySchema }), async (req: AuthRequest, res) => {
    try {
        const b = req.body;
        await ensureStudent(b.student_id, req.userId!);
        const r = await query(
            `INSERT INTO school_supplies
                (user_id, student_id, category, label, quantity, isbn, subject, store,
                 unit_price, is_purchased, purchased_at, notes, position)
             VALUES ($1,$2,$3,$4,COALESCE($5,1),$6,$7,$8,$9,COALESCE($10,FALSE),$11,$12,
                     COALESCE($13, (SELECT COALESCE(MAX(position),0)+1 FROM school_supplies
                                    WHERE student_id = $2)))
             RETURNING *`,
            [
                req.userId,
                b.student_id,
                b.category,
                b.label,
                b.quantity ?? null,
                b.isbn ?? null,
                b.subject ?? null,
                b.store ?? null,
                b.unit_price ?? null,
                b.is_purchased ?? null,
                b.purchased_at ?? null,
                b.notes ?? null,
                b.position ?? null,
            ],
        );
        res.status(201).json({ success: true, data: mapSupply(r.rows[0]) });
    } catch (error) {
        if (handleFkError(error, res)) return;
        fail(res, 'create_supply_failed', error);
    }
});

router.patch(
    '/supplies/:id',
    validate({ body: supplyPatchSchema }),
    async (req: AuthRequest, res) => {
        try {
            const body = { ...req.body };
            // Checking the box stamps the purchase date; unchecking clears it.
            // An explicit purchased_at in the same patch always wins.
            if (body.is_purchased !== undefined && body.purchased_at === undefined) {
                body.purchased_at = body.is_purchased
                    ? new Date().toISOString().slice(0, 10)
                    : null;
            }
            const { updates, values } = buildUpdate(body);
            if (updates.length === 0) {
                return res.status(400).json({ success: false, error: 'No fields to update' });
            }
            values.push(req.params.id, req.userId);
            const r = await query(
                `UPDATE school_supplies SET ${updates.join(', ')}
                 WHERE id = $${values.length - 1} AND user_id = $${values.length}
                 RETURNING *`,
                values,
            );
            if (r.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Supply not found' });
            }
            res.json({ success: true, data: mapSupply(r.rows[0]) });
        } catch (error) {
            fail(res, 'update_supply_failed', error);
        }
    },
);

router.delete('/supplies/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            'DELETE FROM school_supplies WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Supply not found' });
        }
        res.json({ success: true });
    } catch (error) {
        fail(res, 'delete_supply_failed', error);
    }
});

// ---------------------------------------------------------------------------
// Study sessions
// ---------------------------------------------------------------------------

router.get(
    '/study-sessions',
    validate({ query: studySessionListQuerySchema }),
    async (req: AuthRequest, res) => {
        try {
            const { student_id, subject, status, from, to } = req.query as {
                student_id?: string;
                subject?: string;
                status?: string;
                from?: string;
                to?: string;
            };
            const params: any[] = [req.userId];
            let sql = 'SELECT * FROM school_study_sessions WHERE user_id = $1';
            if (student_id) {
                params.push(student_id);
                sql += ` AND student_id = $${params.length}`;
            }
            if (subject) {
                params.push(subject);
                sql += ` AND subject = $${params.length}`;
            }
            if (status && status !== 'all') {
                params.push(status);
                sql += ` AND status = $${params.length}`;
            }
            if (from) {
                params.push(from);
                sql += ` AND scheduled_date >= $${params.length}`;
            }
            if (to) {
                params.push(to);
                sql += ` AND scheduled_date <= $${params.length}`;
            }
            sql += ' ORDER BY scheduled_date ASC, start_time ASC NULLS LAST';
            const r = await query(sql, params);
            res.json({ success: true, data: r.rows.map(mapSession) });
        } catch (error) {
            fail(res, 'list_sessions_failed', error);
        }
    },
);

router.post(
    '/study-sessions',
    validate({ body: studySessionBodySchema }),
    async (req: AuthRequest, res) => {
        try {
            const b = req.body;
            await ensureStudent(b.student_id, req.userId!);
            const r = await query(
                `INSERT INTO school_study_sessions
                    (user_id, student_id, subject, title, scheduled_date, start_time,
                     duration_minutes, objective, status, mastery, recurrence_days, notes,
                     reminder_enabled)
                 VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,30),$8,COALESCE($9,'Planifiée'),$10,$11,$12,
                         COALESCE($13,TRUE))
                 RETURNING *`,
                [
                    req.userId,
                    b.student_id,
                    b.subject,
                    b.title,
                    b.scheduled_date,
                    b.start_time ?? null,
                    b.duration_minutes ?? null,
                    b.objective ?? null,
                    b.status ?? null,
                    b.mastery ?? null,
                    b.recurrence_days ?? null,
                    b.notes ?? null,
                    b.reminder_enabled ?? null,
                ],
            );
            res.status(201).json({ success: true, data: mapSession(r.rows[0]) });
        } catch (error) {
            if (handleFkError(error, res)) return;
            fail(res, 'create_session_failed', error);
        }
    },
);

/**
 * Weekly-plan generator: expands a "subject × weekday" template into concrete
 * sessions over `weeks` weeks. Runs in one transaction so a partial plan never
 * lands. With skip_breaks, dates covered by a school_break or a 'Congé' event
 * are dropped — no point planning homework on a holiday.
 */
router.post(
    '/study-sessions/plan',
    validate({ body: studyPlanSchema }),
    async (req: AuthRequest, res) => {
        const b = req.body;
        const client = await getClient();
        try {
            await ensureStudent(b.student_id, req.userId!);

            const start = new Date(`${b.start_date}T00:00:00`);
            const dayCount = b.weeks * 7;

            // Collect the dates to skip up-front (two small queries) rather than
            // asking the DB once per generated session.
            const skip = new Set<string>();
            if (b.skip_breaks !== false) {
                const lastDay = new Date(start);
                lastDay.setDate(lastDay.getDate() + dayCount - 1);
                const endKey = lastDay.toISOString().slice(0, 10);
                const ranges = await client.query(
                    `SELECT start_date, end_date FROM school_breaks
                     WHERE user_id = $1 AND start_date <= $3 AND end_date >= $2
                     UNION ALL
                     SELECT start_date, COALESCE(end_date, start_date) FROM school_events
                     WHERE user_id = $1 AND event_type = 'Congé'
                       AND start_date <= $3 AND COALESCE(end_date, start_date) >= $2`,
                    [req.userId, b.start_date, endKey],
                );
                for (const row of ranges.rows) {
                    const from = toDateKeyLoose(row.start_date);
                    const to = toDateKeyLoose(row.end_date);
                    if (!from || !to) continue;
                    const cursor = new Date(`${from}T00:00:00`);
                    const stop = new Date(`${to}T00:00:00`);
                    while (cursor <= stop) {
                        skip.add(cursor.toISOString().slice(0, 10));
                        cursor.setDate(cursor.getDate() + 1);
                    }
                }
            }

            const slotsByWeekday = new Map<number, typeof b.slots>();
            for (const slot of b.slots) {
                const list = slotsByWeekday.get(slot.weekday) ?? [];
                list.push(slot);
                slotsByWeekday.set(slot.weekday, list);
            }

            await client.query('BEGIN');
            const created: any[] = [];
            for (let offset = 0; offset < dayCount; offset++) {
                const day = new Date(start);
                day.setDate(day.getDate() + offset);
                const dateKey = day.toISOString().slice(0, 10);
                if (skip.has(dateKey)) continue;
                for (const slot of slotsByWeekday.get(day.getDay()) ?? []) {
                    const inserted = await client.query(
                        `INSERT INTO school_study_sessions
                            (user_id, student_id, subject, title, scheduled_date, start_time,
                             duration_minutes, objective)
                         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,30),$8)
                         RETURNING *`,
                        [
                            req.userId,
                            b.student_id,
                            slot.subject,
                            slot.title ?? slot.subject,
                            dateKey,
                            slot.start_time ?? null,
                            slot.duration_minutes ?? null,
                            slot.objective ?? null,
                        ],
                    );
                    created.push(inserted.rows[0]);
                }
            }
            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: {
                    created: created.length,
                    skipped_days: skip.size,
                    sessions: created.map(mapSession),
                },
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            if (handleFkError(error, res)) return;
            fail(res, 'plan_sessions_failed', error);
        } finally {
            client.release();
        }
    },
);

router.patch(
    '/study-sessions/:id',
    validate({ body: studySessionPatchSchema }),
    async (req: AuthRequest, res) => {
        try {
            const { updates, values } = buildUpdate(req.body);
            if (updates.length === 0) {
                return res.status(400).json({ success: false, error: 'No fields to update' });
            }
            values.push(req.params.id, req.userId);
            const r = await query(
                `UPDATE school_study_sessions SET ${updates.join(', ')}
                 WHERE id = $${values.length - 1} AND user_id = $${values.length}
                 RETURNING *`,
                values,
            );
            if (r.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Session not found' });
            }
            res.json({ success: true, data: mapSession(r.rows[0]) });
        } catch (error) {
            fail(res, 'update_session_failed', error);
        }
    },
);

/**
 * Mark a session done. When recurrence_days is set, the next occurrence is
 * inserted at scheduled_date + N days in the same transaction — same policy as
 * garden_care, so a weekly slot keeps rolling without manual re-entry.
 */
router.patch(
    '/study-sessions/:id/complete',
    validate({ body: studySessionCompleteSchema }),
    async (req: AuthRequest, res) => {
        const client = await getClient();
        try {
            await client.query('BEGIN');
            const current = await client.query(
                'SELECT * FROM school_study_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE',
                [req.params.id, req.userId],
            );
            if (current.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Session not found' });
            }
            const before = current.rows[0];

            const updated = await client.query(
                `UPDATE school_study_sessions
                 SET status = 'Faite',
                     completed_at = NOW(),
                     mastery = COALESCE($3, mastery),
                     notes = COALESCE($4, notes)
                 WHERE id = $1 AND user_id = $2
                 RETURNING *`,
                [req.params.id, req.userId, req.body.mastery ?? null, req.body.notes ?? null],
            );

            // Only roll the recurrence forward on the first completion, so
            // re-completing an already-done session can't fan out duplicates.
            let next: any = null;
            if (before.recurrence_days && before.status !== 'Faite') {
                const inserted = await client.query(
                    `INSERT INTO school_study_sessions
                        (user_id, student_id, subject, title, scheduled_date, start_time,
                         duration_minutes, objective, recurrence_days, reminder_enabled)
                     VALUES ($1,$2,$3,$4, ($5::date + ($6 || ' days')::interval)::date,
                             $7,$8,$9,$6,$10)
                     RETURNING *`,
                    [
                        req.userId,
                        before.student_id,
                        before.subject,
                        before.title,
                        toDateKeyLoose(before.scheduled_date),
                        before.recurrence_days,
                        before.start_time,
                        before.duration_minutes,
                        before.objective,
                        before.reminder_enabled,
                    ],
                );
                next = inserted.rows[0];
            }

            await client.query('COMMIT');
            res.json({
                success: true,
                data: {
                    ...mapSession(updated.rows[0]),
                    next_occurrence: next ? mapSession(next) : null,
                },
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            fail(res, 'complete_session_failed', error);
        } finally {
            client.release();
        }
    },
);

router.delete('/study-sessions/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            'DELETE FROM school_study_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }
        res.json({ success: true });
    } catch (error) {
        fail(res, 'delete_session_failed', error);
    }
});

// ---------------------------------------------------------------------------
// Grades
// ---------------------------------------------------------------------------

router.get('/grades', validate({ query: gradeListQuerySchema }), async (req: AuthRequest, res) => {
    try {
        const { student_id, subject, term } = req.query as {
            student_id?: string;
            subject?: string;
            term?: string;
        };
        const params: any[] = [req.userId];
        let sql = 'SELECT * FROM school_grades WHERE user_id = $1';
        if (student_id) {
            params.push(student_id);
            sql += ` AND student_id = $${params.length}`;
        }
        if (subject) {
            params.push(subject);
            sql += ` AND subject = $${params.length}`;
        }
        if (term) {
            params.push(term);
            sql += ` AND term = $${params.length}`;
        }
        sql += ' ORDER BY evaluated_on DESC, created_at DESC';
        const r = await query(sql, params);
        res.json({ success: true, data: r.rows.map(mapGrade) });
    } catch (error) {
        fail(res, 'list_grades_failed', error);
    }
});

router.post('/grades', validate({ body: gradeBodySchema }), async (req: AuthRequest, res) => {
    try {
        const b = req.body;
        await ensureStudent(b.student_id, req.userId!);
        const r = await query(
            `INSERT INTO school_grades
                (user_id, student_id, subject, title, evaluated_on, score, max_score, term, notes)
             VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,100),$8,$9)
             RETURNING *`,
            [
                req.userId,
                b.student_id,
                b.subject,
                b.title,
                b.evaluated_on,
                b.score,
                b.max_score ?? null,
                b.term ?? null,
                b.notes ?? null,
            ],
        );
        res.status(201).json({ success: true, data: mapGrade(r.rows[0]) });
    } catch (error) {
        if (handleFkError(error, res)) return;
        fail(res, 'create_grade_failed', error);
    }
});

router.patch('/grades/:id', validate({ body: gradePatchSchema }), async (req: AuthRequest, res) => {
    try {
        const { updates, values } = buildUpdate(req.body);
        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }
        values.push(req.params.id, req.userId);
        const r = await query(
            `UPDATE school_grades SET ${updates.join(', ')}
             WHERE id = $${values.length - 1} AND user_id = $${values.length}
             RETURNING *`,
            values,
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Grade not found' });
        }
        res.json({ success: true, data: mapGrade(r.rows[0]) });
    } catch (error) {
        fail(res, 'update_grade_failed', error);
    }
});

router.delete('/grades/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            'DELETE FROM school_grades WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Grade not found' });
        }
        res.json({ success: true });
    } catch (error) {
        fail(res, 'delete_grade_failed', error);
    }
});

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

router.get('/presets', (_req: AuthRequest, res) => {
    res.json({ success: true, data: listPresets() });
});

/**
 * Import a preset onto a student. Idempotent by design: an event is skipped
 * when the student already has one with the same (title, start_date), and a
 * supply when it already has the same (category, label). Re-importing after a
 * partial edit therefore tops the list up instead of duplicating it.
 */
// The param is deliberately NOT named `:id`: app.param('id', validateUuidParam)
// forces UUIDs, and a preset is addressed by a slug.
router.post(
    '/presets/:presetId/apply',
    validate({ body: presetApplySchema }),
    async (req: AuthRequest, res) => {
        const preset = findPreset(req.params.presetId);
        if (!preset) {
            return res.status(404).json({ success: false, error: 'Preset not found' });
        }
        const b = req.body;
        const client = await getClient();
        try {
            await ensureStudent(b.student_id, req.userId!);
            await client.query('BEGIN');

            // Fill in the student's school/grade from the preset, but only
            // where the parent left the field empty — an import must never
            // overwrite what they typed themselves.
            await client.query(
                `UPDATE school_students
                 SET school_name = COALESCE(school_name, $3),
                     grade_level = COALESCE(grade_level, $4)
                 WHERE id = $1 AND user_id = $2`,
                [b.student_id, req.userId, preset.school_name, preset.grade_level],
            );

            let eventsCreated = 0;
            let eventsSkipped = 0;
            if (b.include_events !== false) {
                for (const e of preset.events) {
                    const existing = await client.query(
                        `SELECT id FROM school_events
                         WHERE user_id = $1 AND student_id = $2 AND title = $3 AND start_date = $4`,
                        [req.userId, b.student_id, e.title, e.start_date],
                    );
                    if (existing.rows.length > 0) {
                        eventsSkipped++;
                        continue;
                    }
                    await client.query(
                        `INSERT INTO school_events
                            (user_id, student_id, title, event_type, start_date, end_date,
                             notes, reminder_enabled, reminder_days_before)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,TRUE),COALESCE($9,1))`,
                        [
                            req.userId,
                            b.student_id,
                            e.title,
                            e.event_type,
                            e.start_date,
                            e.end_date ?? null,
                            e.notes ?? null,
                            e.reminder_enabled ?? null,
                            e.reminder_days_before ?? null,
                        ],
                    );
                    eventsCreated++;
                }
            }

            let suppliesCreated = 0;
            let suppliesSkipped = 0;
            if (b.include_supplies !== false) {
                let position = 0;
                for (const s of preset.supplies) {
                    position++;
                    const existing = await client.query(
                        `SELECT id FROM school_supplies
                         WHERE user_id = $1 AND student_id = $2 AND category = $3 AND label = $4`,
                        [req.userId, b.student_id, s.category, s.label],
                    );
                    if (existing.rows.length > 0) {
                        suppliesSkipped++;
                        continue;
                    }
                    await client.query(
                        `INSERT INTO school_supplies
                            (user_id, student_id, category, label, quantity, isbn, subject,
                             store, notes, position)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                        [
                            req.userId,
                            b.student_id,
                            s.category,
                            s.label,
                            s.quantity,
                            s.isbn ?? null,
                            s.subject ?? null,
                            s.store ?? null,
                            s.notes ?? null,
                            position,
                        ],
                    );
                    suppliesCreated++;
                }
            }

            await client.query('COMMIT');
            logger.info('school.preset_applied', {
                presetId: preset.id,
                eventsCreated,
                suppliesCreated,
            });
            res.status(201).json({
                success: true,
                data: {
                    preset_id: preset.id,
                    events_created: eventsCreated,
                    events_skipped: eventsSkipped,
                    supplies_created: suppliesCreated,
                    supplies_skipped: suppliesSkipped,
                    caveat: preset.caveat,
                },
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            if (handleFkError(error, res)) return;
            fail(res, 'apply_preset_failed', error);
        } finally {
            client.release();
        }
    },
);

// ---------------------------------------------------------------------------
// Overview aggregator
// ---------------------------------------------------------------------------

router.get(
    '/statistics',
    validate({ query: statisticsQuerySchema }),
    async (req: AuthRequest, res) => {
        try {
            const studentId = (req.query as { student_id?: string }).student_id ?? null;
            // $2 IS NULL short-circuits the filter, so one SQL text serves both
            // "all students" and "this student".
            const params = [req.userId, studentId];

            const upcomingEvents = await query(
                `${SELECT_EVENT_FULL}
                 WHERE e.user_id = $1
                   AND ($2::uuid IS NULL OR e.student_id = $2)
                   AND COALESCE(e.end_date, e.start_date) >= CURRENT_DATE
                 ORDER BY e.start_date ASC
                 LIMIT 8`,
                params,
            );

            const upcomingSessions = await query(
                `SELECT * FROM school_study_sessions
                 WHERE user_id = $1
                   AND ($2::uuid IS NULL OR student_id = $2)
                   AND status = 'Planifiée'
                   AND scheduled_date <= CURRENT_DATE + INTERVAL '7 days'
                 ORDER BY scheduled_date ASC, start_time ASC NULLS LAST
                 LIMIT 8`,
                params,
            );

            const counts = await query(
                `SELECT
                    (SELECT COUNT(*) FROM school_supplies
                      WHERE user_id = $1 AND ($2::uuid IS NULL OR student_id = $2)) AS supplies_total,
                    (SELECT COUNT(*) FROM school_supplies
                      WHERE user_id = $1 AND ($2::uuid IS NULL OR student_id = $2)
                        AND is_purchased = TRUE) AS supplies_purchased,
                    (SELECT COALESCE(SUM(unit_price * quantity), 0) FROM school_supplies
                      WHERE user_id = $1 AND ($2::uuid IS NULL OR student_id = $2)
                        AND unit_price IS NOT NULL) AS supplies_cost,
                    (SELECT COUNT(*) FROM school_events
                      WHERE user_id = $1 AND ($2::uuid IS NULL OR student_id = $2)
                        AND start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days')
                      AS events_next_7d,
                    (SELECT COUNT(*) FROM school_study_sessions
                      WHERE user_id = $1 AND ($2::uuid IS NULL OR student_id = $2)
                        AND status = 'Planifiée' AND scheduled_date = CURRENT_DATE)
                      AS sessions_today,
                    (SELECT COUNT(*) FROM school_study_sessions
                      WHERE user_id = $1 AND ($2::uuid IS NULL OR student_id = $2)
                        AND status = 'Planifiée' AND scheduled_date < CURRENT_DATE)
                      AS sessions_late,
                    (SELECT COALESCE(SUM(duration_minutes), 0) FROM school_study_sessions
                      WHERE user_id = $1 AND ($2::uuid IS NULL OR student_id = $2)
                        AND status = 'Faite'
                        AND scheduled_date >= CURRENT_DATE - INTERVAL '7 days')
                      AS minutes_done_7d`,
                params,
            );

            // Per-subject picture: average grade, study minutes done, and the
            // average post-session mastery. This is what drives the "à
            // travailler" list on the page.
            const bySubject = await query(
                `SELECT subject,
                        AVG(percentage) AS avg_percentage,
                        COUNT(*) AS grades_count,
                        MAX(evaluated_on) AS last_evaluated_on
                 FROM (
                    SELECT subject, evaluated_on, (score / max_score) * 100 AS percentage
                    FROM school_grades
                    WHERE user_id = $1 AND ($2::uuid IS NULL OR student_id = $2)
                 ) g
                 GROUP BY subject
                 ORDER BY avg_percentage ASC`,
                params,
            );

            const studyBySubject = await query(
                `SELECT subject,
                        COALESCE(SUM(duration_minutes) FILTER (WHERE status = 'Faite'), 0) AS minutes_done,
                        COUNT(*) FILTER (WHERE status = 'Faite') AS sessions_done,
                        COUNT(*) FILTER (WHERE status = 'Planifiée') AS sessions_planned,
                        AVG(mastery) FILTER (WHERE mastery IS NOT NULL) AS avg_mastery
                 FROM school_study_sessions
                 WHERE user_id = $1 AND ($2::uuid IS NULL OR student_id = $2)
                 GROUP BY subject`,
                params,
            );

            const studyMap = new Map<string, any>(
                studyBySubject.rows.map((r: any) => [r.subject, r]),
            );
            const subjects = new Set<string>([
                ...bySubject.rows.map((r: any) => r.subject as string),
                ...studyBySubject.rows.map((r: any) => r.subject as string),
            ]);

            const c = counts.rows[0];
            res.json({
                success: true,
                data: {
                    upcoming_events: upcomingEvents.rows.map(mapEvent),
                    upcoming_sessions: upcomingSessions.rows.map(mapSession),
                    counts: {
                        supplies_total: Number(c.supplies_total),
                        supplies_purchased: Number(c.supplies_purchased),
                        supplies_cost: Number(c.supplies_cost),
                        events_next_7d: Number(c.events_next_7d),
                        sessions_today: Number(c.sessions_today),
                        sessions_late: Number(c.sessions_late),
                        minutes_done_7d: Number(c.minutes_done_7d),
                    },
                    by_subject: [...subjects].map((subject) => {
                        const grade = bySubject.rows.find((r: any) => r.subject === subject);
                        const study = studyMap.get(subject);
                        return {
                            subject,
                            avg_percentage:
                                grade?.avg_percentage != null
                                    ? Math.round(Number(grade.avg_percentage) * 10) / 10
                                    : null,
                            grades_count: grade ? Number(grade.grades_count) : 0,
                            last_evaluated_on: grade
                                ? toDateKeyLoose(grade.last_evaluated_on)
                                : null,
                            minutes_done: study ? Number(study.minutes_done) : 0,
                            sessions_done: study ? Number(study.sessions_done) : 0,
                            sessions_planned: study ? Number(study.sessions_planned) : 0,
                            avg_mastery:
                                study?.avg_mastery != null
                                    ? Math.round(Number(study.avg_mastery) * 10) / 10
                                    : null,
                        };
                    }),
                },
            });
        } catch (error) {
            fail(res, 'statistics_failed', error);
        }
    },
);

export default router;
