import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// =============================================================================
// /api/school-breaks — auth, validation, and the range invariant.
//
// The DB is mocked: we branch on the SQL text so the auth middleware's user
// lookup resolves and INSERT/UPDATE return a plausible row. What's worth
// pinning here is the range check, because it has two halves that can't both
// live in zod: a full body is checked by the schema, but a ONE-SIDED patch can
// still invert the range against the bound already stored — only the route sees
// that, and an inverted range would violate the table's CHECK constraint.
// =============================================================================

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BREAK_ID = '33333333-3333-4333-8333-333333333333';

const STORED = { start_date: '2026-07-04', end_date: '2026-09-01' };

const makeQueryMock = (opts: { existing?: unknown[] } = {}) =>
    vi.fn(async (sql: string) => {
        if (/family_owner_id/i.test(sql)) return { rows: [{ family_owner_id: null }] };

        if (/SELECT start_date, end_date FROM school_breaks/i.test(sql)) {
            const rows = opts.existing ?? [STORED];
            return { rows, rowCount: rows.length };
        }
        if (/INSERT INTO school_breaks|UPDATE school_breaks/i.test(sql)) {
            return {
                rows: [
                    {
                        id: BREAK_ID,
                        label: "Vacances d'été",
                        start_date: '2026-07-04',
                        end_date: '2026-09-01',
                    },
                ],
                rowCount: 1,
            };
        }
        if (/DELETE FROM school_breaks/i.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
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
    queryMock.current = makeQueryMock();
});

const authed = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(app)
        [method](path)
        .set('Cookie', `${ACCESS_COOKIE_NAME}=${generateAccessToken(USER_ID)}`);

describe('school breaks routes', () => {
    it('requires authentication', async () => {
        const res = await request(app).get('/api/school-breaks');
        expect(res.status).toBe(401);
    });

    it('creates a valid period', async () => {
        const res = await authed('post', '/api/school-breaks').send({
            label: "Vacances d'été",
            start_date: '2026-07-04',
            end_date: '2026-09-01',
        });
        expect(res.status).toBe(201);
        expect(res.body.data.label).toBe("Vacances d'été");
    });

    it('rejects an inverted range on create (400)', async () => {
        const res = await authed('post', '/api/school-breaks').send({
            label: 'À l’envers',
            start_date: '2026-09-01',
            end_date: '2026-07-04',
        });
        expect(res.status).toBe(400);
    });

    it('rejects a malformed date (400)', async () => {
        const res = await authed('post', '/api/school-breaks').send({
            label: 'Nope',
            start_date: '04/07/2026',
            end_date: '2026-09-01',
        });
        expect(res.status).toBe(400);
    });

    it('rejects a period with no label (400)', async () => {
        const res = await authed('post', '/api/school-breaks').send({
            label: '   ',
            start_date: '2026-07-04',
            end_date: '2026-09-01',
        });
        expect(res.status).toBe(400);
    });

    it('rejects a one-sided patch that inverts the STORED range (400)', async () => {
        // Stored: 2026-07-04 → 2026-09-01. Moving only the start past the stored
        // end would invert it. zod can't see this — the route must.
        const res = await authed('patch', `/api/school-breaks/${BREAK_ID}`).send({
            start_date: '2026-10-01',
        });
        expect(res.status).toBe(400);
    });

    it('accepts a one-sided patch that keeps the range valid', async () => {
        const res = await authed('patch', `/api/school-breaks/${BREAK_ID}`).send({
            end_date: '2026-08-20',
        });
        expect(res.status).toBe(200);
    });

    it('404s when patching a period that is not yours', async () => {
        queryMock.current = makeQueryMock({ existing: [] });
        const res = await authed('patch', `/api/school-breaks/${BREAK_ID}`).send({
            label: 'Hijack',
        });
        expect(res.status).toBe(404);
    });

    it('rejects an empty patch (400)', async () => {
        const res = await authed('patch', `/api/school-breaks/${BREAK_ID}`).send({});
        expect(res.status).toBe(400);
    });

    it('deletes a period', async () => {
        const res = await authed('delete', `/api/school-breaks/${BREAK_ID}`);
        expect(res.status).toBe(200);
    });
});
