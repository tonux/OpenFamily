import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// =============================================================================
// House care routes — auth, validation, and the seed/profile happy paths.
//
// The DB is mocked by branching on the SQL text, same approach as garden.test:
// it exercises the zod layer (which runs before any DB access) and the wiring,
// without needing a live Postgres.
// =============================================================================

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';

const taskRow = (overrides: Record<string, unknown> = {}) => ({
    id: TASK_ID,
    user_id: USER_ID,
    title: 'Nettoyer les gouttières',
    category: 'Toiture',
    season: 'Automne',
    frequency: 'Annuel',
    interval_months: 12,
    month_start: 10,
    month_end: 11,
    priority: 'Critique',
    responsibility: 'Soi-même',
    estimated_minutes: 90,
    estimated_cost: null,
    risk_if_skipped: 'Barrage de glace',
    steps: [],
    equipment_id: null,
    source: 'catalog',
    catalog_key: 'fall-gutters',
    is_active: true,
    last_done_on: null,
    next_due_on: '2026-10-01',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
});

const makeQueryMock = () =>
    vi.fn(async (sql: string) => {
        if (/family_owner_id/i.test(sql)) {
            // Auth middleware scope lookup.
            return { rows: [{ family_owner_id: null }] };
        }
        if (/INSERT INTO house_profile/i.test(sql)) {
            return {
                rows: [
                    {
                        user_id: USER_ID,
                        dwelling_type: 'Unifamiliale',
                        build_year: 1998,
                        living_area_m2: null,
                        occupants: null,
                        climate_zone: 'Continental humide (hivers rigoureux)',
                        has_basement: true,
                        basement_finished: false,
                        has_sump_pump: true,
                        has_garage: false,
                        has_pool: false,
                        has_septic: false,
                        has_well: false,
                        has_irrigation: false,
                        has_air_exchanger: false,
                        heating_types: ['Thermopompe', 'Poêle à bois'],
                        roof_type: null,
                        roof_year: 2012,
                        water_heater_year: null,
                        windows_year: null,
                        siding_type: null,
                        property_value: null,
                        notes: null,
                        created_at: new Date(),
                        updated_at: new Date(),
                    },
                ],
            };
        }
        if (/UPDATE house_care_tasks SET last_done_on/i.test(sql)) {
            return { rows: [taskRow({ last_done_on: '2026-10-20', next_due_on: '2027-10-20' })] };
        }
        if (/FROM house_care_tasks/i.test(sql)) return { rows: [taskRow()] };
        if (/INSERT INTO house_care_tasks/i.test(sql)) return { rows: [taskRow()] };
        return { rows: [] };
    });

const queryMock = { current: makeQueryMock() };

const makeClientMock = () => ({
    query: vi.fn(async (sql: string, params?: unknown[]) => queryMock.current(sql, params)),
    release: vi.fn(),
});
const clientMock = { current: makeClientMock() };

vi.mock('../../src/db', () => ({
    default: {},
    query: (sql: string, params?: unknown[]) => queryMock.current(sql, params),
    getClient: async () => clientMock.current,
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
    clientMock.current = makeClientMock();
});

const authed = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
    request(app)
        [method](path)
        .set('Cookie', `${ACCESS_COOKIE_NAME}=${generateAccessToken(USER_ID)}`);

describe('house care routes', () => {
    it('requires authentication', async () => {
        const res = await request(app).get('/api/house/care/overview');
        expect(res.status).toBe(401);
    });

    it('resolves /api/house/care ahead of the /api/house router', async () => {
        // The care router is mounted first on purpose; if that ordering broke,
        // this would 404 through the equipment routes.
        const res = await authed('get', '/api/house/care/profile');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns profile defaults when the user has no profile row', async () => {
        const res = await authed('get', '/api/house/care/profile');
        expect(res.body.data.exists).toBe(false);
        expect(res.body.data.dwelling_type).toBe('Unifamiliale');
        expect(res.body.data.climate_zone).toBe('Continental humide (hivers rigoureux)');
    });

    it('upserts a profile and echoes it back', async () => {
        const res = await authed('put', '/api/house/care/profile').send({
            build_year: 1998,
            has_sump_pump: true,
            heating_types: ['Thermopompe', 'Poêle à bois'],
        });
        expect(res.status).toBe(200);
        expect(res.body.data.exists).toBe(true);
        expect(res.body.data.heating_types).toEqual(['Thermopompe', 'Poêle à bois']);
    });

    it('rejects an unknown dwelling type (400)', async () => {
        const res = await authed('put', '/api/house/care/profile').send({
            dwelling_type: 'Yourte',
        });
        expect(res.status).toBe(400);
    });

    it('rejects an implausible build year (400)', async () => {
        const res = await authed('put', '/api/house/care/profile').send({ build_year: 19999 });
        expect(res.status).toBe(400);
    });

    it('rejects a task with an unknown category (400)', async () => {
        const res = await authed('post', '/api/house/care/tasks').send({
            title: 'Test',
            category: 'Piscine',
            season: 'Été',
            frequency: 'Annuel',
            priority: 'Important',
            responsibility: 'Soi-même',
        });
        expect(res.status).toBe(400);
    });

    it('rejects a half-specified seasonal window (400)', async () => {
        // month_start without month_end silently behaves as "no window", which
        // is the opposite of what the author meant — so it's a hard error.
        const res = await authed('post', '/api/house/care/tasks').send({
            title: 'Test',
            category: 'Toiture',
            season: 'Automne',
            frequency: 'Annuel',
            priority: 'Important',
            responsibility: 'Soi-même',
            month_start: 10,
        });
        expect(res.status).toBe(400);
    });

    it('accepts a valid task', async () => {
        const res = await authed('post', '/api/house/care/tasks').send({
            title: 'Nettoyer les gouttières',
            category: 'Toiture',
            season: 'Automne',
            frequency: 'Annuel',
            interval_months: 12,
            month_start: 10,
            month_end: 11,
            priority: 'Critique',
            responsibility: 'Soi-même',
            steps: ['Vider', 'Rincer'],
        });
        expect(res.status).toBe(201);
        expect(res.body.data.title).toBe('Nettoyer les gouttières');
    });

    it('rejects a bulk create over the 40-task cap (400)', async () => {
        const one = {
            title: 'T',
            category: 'Intérieur',
            season: "Toute l'année",
            frequency: 'Annuel',
            priority: 'Important',
            responsibility: 'Soi-même',
        };
        const res = await authed('post', '/api/house/care/tasks/bulk').send({
            tasks: Array.from({ length: 41 }, () => one),
        });
        expect(res.status).toBe(400);
    });

    it('rejects an unknown completion status (400)', async () => {
        const res = await authed('post', `/api/house/care/tasks/${TASK_ID}/complete`).send({
            status: 'Peut-être',
        });
        expect(res.status).toBe(400);
    });

    it('records a completion and advances the schedule', async () => {
        const res = await authed('post', `/api/house/care/tasks/${TASK_ID}/complete`).send({
            done_on: '2026-10-20',
            status: 'Fait',
            observation: 'RAS',
        });
        expect(res.status).toBe(200);

        const statements = clientMock.current.query.mock.calls.map((c) => String(c[0]));
        expect(statements.some((s) => /INSERT INTO house_care_logs/i.test(s))).toBe(true);
        expect(statements.some((s) => /UPDATE house_care_tasks SET last_done_on/i.test(s))).toBe(
            true,
        );
        expect(statements).toContain('COMMIT');
    });

    it('does not advance the schedule when the task is skipped', async () => {
        const res = await authed('post', `/api/house/care/tasks/${TASK_ID}/complete`).send({
            done_on: '2026-10-20',
            status: 'Ignoré',
        });
        expect(res.status).toBe(200);

        const statements = clientMock.current.query.mock.calls.map((c) => String(c[0]));
        expect(statements.some((s) => /INSERT INTO house_care_logs/i.test(s))).toBe(true);
        expect(statements.some((s) => /UPDATE house_care_tasks SET last_done_on/i.test(s))).toBe(
            false,
        );
    });

    it('seeds the catalog and skips what the user already has', async () => {
        // The mocked SELECT returns the 'fall-gutters' row as already present,
        // so re-seeding must not create it a second time.
        const res = await authed('post', '/api/house/care/seed').send({});
        expect(res.status).toBe(201);
        expect(res.body.data.applicable_count).toBeGreaterThan(0);

        const inserted = clientMock.current.query.mock.calls
            .filter((c) => /INSERT INTO house_care_tasks/i.test(String(c[0])))
            .map((c) => (c[1] as unknown[])[16]); // catalog_key column
        expect(inserted).not.toContain('fall-gutters');
    });

    it('rejects an unknown query filter (400)', async () => {
        const res = await authed('get', '/api/house/care/tasks?colour=blue');
        expect(res.status).toBe(400);
    });
});

describe('house care AI routes', () => {
    it('rejects a diagnosis with too short a symptom (400)', async () => {
        const res = await authed('post', '/api/ai/house/diagnose').send({ symptom: 'bruit' });
        expect(res.status).toBe(400);
    });

    it('rejects unknown keys on the care-plan body (400)', async () => {
        const res = await authed('post', '/api/ai/house/care-plan').send({ zoneId: 'nope' });
        expect(res.status).toBe(400);
    });
});
