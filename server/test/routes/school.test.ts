import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// =============================================================================
// School routes — auth, validation and the two behaviours that aren't pure CRUD:
//  - PATCH /supplies/:id stamps purchased_at when the checkbox flips on
//  - POST /presets/:id/apply refuses an unknown preset before touching the DB
//
// The DB is mocked: we branch on the SQL text so the auth middleware's user
// lookup resolves and INSERT ... RETURNING yields a plausible row. This
// exercises the zod layer (which runs before any DB access) and the wiring,
// without needing a live Postgres.
// =============================================================================

const USER_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';
const SUPPLY_ID = '33333333-3333-4333-8333-333333333333';
const SHEET_ID = '44444444-4444-4444-8444-444444444444';

const supplyRow = (overrides: Record<string, unknown> = {}) => ({
    id: SUPPLY_ID,
    student_id: STUDENT_ID,
    category: 'Fourniture',
    label: 'Bâtons de colle',
    quantity: 2,
    isbn: null,
    subject: null,
    store: null,
    unit_price: null,
    is_purchased: false,
    purchased_at: null,
    notes: null,
    position: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
});

/** Records every (sql, params) pair so tests can assert on what was sent. */
const calls: Array<{ sql: string; params?: unknown[] }> = [];

const makeQueryMock = () =>
    vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (/family_owner_id/i.test(sql)) {
            // Auth middleware scope lookup.
            return { rows: [{ family_owner_id: null }] };
        }
        if (/FROM school_students WHERE id/i.test(sql)) {
            // Ownership guard for student_id in request bodies.
            return { rows: [{ id: STUDENT_ID }] };
        }
        if (/INSERT INTO school_students/i.test(sql)) {
            return {
                rows: [
                    {
                        id: STUDENT_ID,
                        family_member_id: null,
                        name: 'Astou',
                        school_name: 'École J.-P.-Labarre',
                        grade_level: '4e année',
                        school_year: '2026-2027',
                        teacher_name: null,
                        class_name: null,
                        color: '#3B82F6',
                        notes: null,
                        created_at: new Date(),
                        updated_at: new Date(),
                    },
                ],
            };
        }
        if (/UPDATE school_supplies/i.test(sql)) {
            return { rows: [supplyRow({ is_purchased: true, purchased_at: '2026-08-09' })] };
        }
        if (/INSERT INTO school_revision_sheets/i.test(sql)) {
            return {
                rows: [
                    {
                        id: SHEET_ID,
                        student_id: STUDENT_ID,
                        subject: 'Mathématique',
                        topic: 'Les fractions',
                        title: 'La pizzeria des fractions',
                        sheet_type: 'Jeu',
                        duration_minutes: 20,
                        focus_warmup: null,
                        instructions: null,
                        exercises: [],
                        status: 'À faire',
                        mastery: null,
                        completed_at: null,
                        printed_at: null,
                        source: null,
                        notes: null,
                        position: 1,
                        created_at: new Date(),
                        updated_at: new Date(),
                    },
                ],
            };
        }
        return { rows: [] };
    });

const queryMock = { current: makeQueryMock() };

vi.mock('../../src/db', () => ({
    default: {},
    query: (sql: string, params?: unknown[]) => queryMock.current(sql, params),
    getClient: vi.fn(),
}));

let app: import('express').Express;
let generateAccessToken: (userId: string) => string;
let ACCESS_COOKIE_NAME: string;

beforeAll(async () => {
    const auth = await import('../../src/middleware/auth');
    generateAccessToken = auth.generateAccessToken;
    ACCESS_COOKIE_NAME = auth.ACCESS_COOKIE_NAME;
    app = (await import('../../src/app')).default;
});

beforeEach(() => {
    calls.length = 0;
    queryMock.current = makeQueryMock();
});

const authed = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(app)
        [method](path)
        .set('Cookie', `${ACCESS_COOKIE_NAME}=${generateAccessToken(USER_ID)}`);

describe('school routes', () => {
    it('requires authentication', async () => {
        const res = await request(app).get('/api/school/students');
        expect(res.status).toBe(401);
    });

    it('creates a valid student (201)', async () => {
        const res = await authed('post', '/api/school/students').send({
            name: 'Astou',
            school_year: '2026-2027',
            grade_level: '4e année',
            school_name: 'École J.-P.-Labarre',
        });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ success: true, data: { school_year: '2026-2027' } });
    });

    it('rejects a malformed school_year (400)', async () => {
        const res = await authed('post', '/api/school/students').send({
            name: 'Astou',
            school_year: '2026/2027',
        });
        expect(res.status).toBe(400);
    });

    it('rejects unknown keys on a student body (strict, 400)', async () => {
        const res = await authed('post', '/api/school/students').send({
            name: 'Astou',
            school_year: '2026-2027',
            bogus: true,
        });
        expect(res.status).toBe(400);
    });

    it('rejects an event whose end_date precedes start_date (400)', async () => {
        const res = await authed('post', '/api/school/events').send({
            title: 'Semaine de relâche',
            event_type: 'Congé',
            start_date: '2027-03-05',
            end_date: '2027-03-01',
        });
        expect(res.status).toBe(400);
    });

    it('rejects an unknown event_type (400)', async () => {
        const res = await authed('post', '/api/school/events').send({
            title: 'X',
            event_type: 'NotAType',
            start_date: '2026-09-01',
        });
        expect(res.status).toBe(400);
    });

    it('rejects a reminder lead time beyond 30 days (400)', async () => {
        const res = await authed('post', '/api/school/events').send({
            title: 'Rentrée',
            event_type: 'Rentrée',
            start_date: '2026-09-01',
            reminder_days_before: 45,
        });
        expect(res.status).toBe(400);
    });

    it('stamps purchased_at when a supply is checked off', async () => {
        const res = await authed('patch', `/api/school/supplies/${SUPPLY_ID}`).send({
            is_purchased: true,
        });
        expect(res.status).toBe(200);
        const update = calls.find((c) => /UPDATE school_supplies/i.test(c.sql));
        expect(update?.sql).toMatch(/purchased_at = \$/);
        // The date is derived server-side, so only its shape is asserted.
        expect(update?.params?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('clears purchased_at when a supply is unchecked', async () => {
        const res = await authed('patch', `/api/school/supplies/${SUPPLY_ID}`).send({
            is_purchased: false,
        });
        expect(res.status).toBe(200);
        const update = calls.find((c) => /UPDATE school_supplies/i.test(c.sql));
        expect(update?.params?.[1]).toBeNull();
    });

    it('rejects a grade whose score exceeds max_score (400)', async () => {
        const res = await authed('post', '/api/school/grades').send({
            student_id: STUDENT_ID,
            subject: 'Mathématique',
            title: 'Examen 1',
            evaluated_on: '2026-10-15',
            score: 25,
            max_score: 20,
        });
        expect(res.status).toBe(400);
    });

    it('rejects a study plan with no slots (400)', async () => {
        const res = await authed('post', '/api/school/study-sessions/plan').send({
            student_id: STUDENT_ID,
            start_date: '2026-09-07',
            weeks: 4,
            slots: [],
        });
        expect(res.status).toBe(400);
    });

    it('lists the available presets', async () => {
        const res = await authed('get', '/api/school/presets');
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBeGreaterThan(0);
        expect(res.body.data[0]).toHaveProperty('supplies_count');
    });

    it('ships one preset per grade, each with its own supply list', async () => {
        const res = await authed('get', '/api/school/presets');
        const ids = res.body.data.map((p: { id: string }) => p.id);
        expect(ids).toContain('qc-patriotes-2026-2027-4e');
        expect(ids).toContain('qc-patriotes-2026-2027-prescolaire');
        // Kindergarten has no workbooks, so its list is shorter than 4e année's.
        const byId = Object.fromEntries(
            res.body.data.map((p: { id: string; supplies_count: number }) => [
                p.id,
                p.supplies_count,
            ]),
        );
        expect(byId['qc-patriotes-2026-2027-prescolaire']).toBeGreaterThan(0);
        expect(byId['qc-patriotes-2026-2027-4e']).toBeGreaterThan(
            byId['qc-patriotes-2026-2027-prescolaire'],
        );
    });

    it('returns 404 for an unknown preset', async () => {
        const res = await authed('post', '/api/school/presets/does-not-exist/apply').send({
            student_id: STUDENT_ID,
        });
        expect(res.status).toBe(404);
    });

    // --- Revision sheets ----------------------------------------------------

    it('creates a revision sheet and sends its exercises as jsonb', async () => {
        const res = await authed('post', '/api/school/revision-sheets').send({
            student_id: STUDENT_ID,
            subject: 'Mathématique',
            title: 'La pizzeria des fractions',
            topic: 'Les fractions',
            sheet_type: 'Jeu',
            focus_warmup: 'Plie une feuille en huit avant de commencer.',
            exercises: [{ prompt: 'Calcule les 3/4 de 20.', answer: '15', answer_lines: 1 }],
        });
        expect(res.status).toBe(201);
        const insert = calls.find((c) => /INSERT INTO school_revision_sheets/i.test(c.sql));
        expect(insert?.sql).toMatch(/\$10::jsonb/);
        // The array must reach pg as a JSON string, not as a JS array — node-pg
        // would otherwise serialise it as a Postgres array literal.
        expect(typeof insert?.params?.[9]).toBe('string');
        expect(JSON.parse(insert!.params![9] as string)).toHaveLength(1);
    });

    it('rejects an unknown sheet_type (400)', async () => {
        const res = await authed('post', '/api/school/revision-sheets').send({
            student_id: STUDENT_ID,
            subject: 'Français',
            title: 'X',
            sheet_type: 'Sudoku',
        });
        expect(res.status).toBe(400);
    });

    it('rejects an exercise with an empty prompt (400)', async () => {
        const res = await authed('post', '/api/school/revision-sheets').send({
            student_id: STUDENT_ID,
            subject: 'Français',
            title: 'X',
            exercises: [{ prompt: '   ' }],
        });
        expect(res.status).toBe(400);
    });

    it('stamps completed_at when a sheet is marked done, and clears it on reopen', async () => {
        queryMock.current = (() => {
            const base = makeQueryMock();
            return vi.fn(async (sql: string, params?: unknown[]) => {
                if (/UPDATE school_revision_sheets/i.test(sql)) {
                    calls.push({ sql, params });
                    return { rows: [{ id: SHEET_ID, exercises: [], position: 1 }] };
                }
                return base(sql, params);
            });
        })();

        const done = await authed('patch', `/api/school/revision-sheets/${SHEET_ID}`).send({
            status: 'Faite',
        });
        expect(done.status).toBe(200);
        let update = calls.find((c) => /UPDATE school_revision_sheets/i.test(c.sql));
        expect(update?.sql).toMatch(/completed_at = \$/);
        expect(update?.params?.[1]).toBeInstanceOf(Date);

        calls.length = 0;
        await authed('patch', `/api/school/revision-sheets/${SHEET_ID}`).send({
            status: 'À faire',
        });
        update = calls.find((c) => /UPDATE school_revision_sheets/i.test(c.sql));
        expect(update?.params?.[1]).toBeNull();
    });

    it('lists the revision booklets with their subjects and totals', async () => {
        const res = await authed('get', '/api/school/revision-booklets');
        expect(res.status).toBe(200);
        const booklet = res.body.data.find((b: { id: string }) => b.id === 'qc-4e-rentree');
        expect(booklet).toBeDefined();
        expect(booklet.sheets_count).toBeGreaterThan(0);
        expect(booklet.subjects).toContain('Mathématique');
        expect(booklet.total_minutes).toBeGreaterThan(0);
    });

    it('returns 404 for an unknown booklet', async () => {
        const res = await authed('post', '/api/school/revision-booklets/nope/apply').send({
            student_id: STUDENT_ID,
        });
        expect(res.status).toBe(404);
    });

    it('rejects mark-printed with an empty id list (400)', async () => {
        const res = await authed('post', '/api/school/revision-sheets/mark-printed').send({
            ids: [],
        });
        expect(res.status).toBe(400);
    });
});
