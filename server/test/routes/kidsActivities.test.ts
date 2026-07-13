import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';

// =============================================================================
// POST /api/ai/dashboard/kids-activities — end-to-end wiring.
//
// The DB and Open-Meteo are mocked; the AI is left DISABLED (no API key in the
// test env), which is exactly the degraded path we most need to hold: the card
// must still come back full, from the static bank, with aiUnavailable flagged.
//
// It also pins the behaviour the whole feature turns on: the day context. The
// clock is frozen to a July weekday, so with no declared school_breaks rows the
// resolver must land on `default_summer` and target TODAY (offset 0), not
// tomorrow.
// =============================================================================

const USER_ID = '11111111-1111-4111-8111-111111111111';
const KID_ID = '22222222-2222-4222-8222-222222222222';

const makeQueryMock = (opts: { breaks?: unknown[]; kids?: unknown[] } = {}) =>
    vi.fn(async (sql: string) => {
        if (/family_owner_id/i.test(sql)) return { rows: [{ family_owner_id: null }] };
        if (/FROM users/i.test(sql)) {
            return { rows: [{ city: 'Dakar', latitude: 14.72, longitude: -17.47 }] };
        }
        if (/FROM school_breaks/i.test(sql)) return { rows: opts.breaks ?? [] };
        if (/FROM family_members/i.test(sql)) {
            return {
                rows: opts.kids ?? [
                    { id: KID_ID, name: 'Awa Ndiaye', birth_date: '2018-03-04', color: '#ff8800' },
                ],
            };
        }
        // Family-context lookups (schedule_entries, appointments, garden_plants,
        // meal_plans, tasks) — empty is fine, the prompt just gets fewer lines.
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
let resetWeatherCache: () => void;
let resetActivityCache: () => void;

/** One Open-Meteo daily block: [today, tomorrow]. Warm and dry → outdoor is on. */
const openMeteoResponse = {
    daily: {
        time: ['2026-07-13', '2026-07-14'],
        temperature_2m_min: [22, 23],
        temperature_2m_max: [29, 30],
        precipitation_sum: [0, 0],
        precipitation_probability_max: [5, 10],
        weathercode: [1, 2],
        windspeed_10m_max: [8, 9],
    },
    timezone: 'Africa/Dakar',
};

beforeAll(async () => {
    const auth = await import('../../src/middleware/auth');
    generateAccessToken = auth.generateAccessToken;
    ACCESS_COOKIE_NAME = auth.ACCESS_COOKIE_NAME;
    app = (await import('../../src/app')).default;
    resetWeatherCache = (await import('../../src/weather/WeatherService'))._resetWeatherCache;
    resetActivityCache = (await import('../../src/ai/AIService'))._resetActivityCache;
});

beforeEach(() => {
    queryMock.current = makeQueryMock();
    resetWeatherCache();
    resetActivityCache();

    // Monday 13 July 2026, 08:30 local — a July weekday: holidays by fallback.
    // Only Date is faked: freezing setTimeout too would deadlock the provider's
    // retry backoff, which this suite deliberately triggers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 13, 8, 30));

    // Open-Meteo answers; the AI provider is down. That combination is the point
    // of this suite: a provider outage is the likeliest real AI failure, and it
    // must degrade to the bank rather than empty the card.
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('open-meteo.com')) {
                return new Response(JSON.stringify(openMeteoResponse), { status: 200 });
            }
            return new Response('upstream is down', { status: 503 });
        }),
    );
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const authed = (path: string) =>
    request(app)
        .post(path)
        .set('Cookie', `${ACCESS_COOKIE_NAME}=${generateAccessToken(USER_ID)}`);

const ENDPOINT = '/api/ai/dashboard/kids-activities';

describe('POST /api/ai/dashboard/kids-activities', () => {
    it('requires authentication', async () => {
        const res = await request(app).post(ENDPOINT).send({});
        expect(res.status).toBe(401);
    });

    it('rejects a longitude sent without a latitude (400)', async () => {
        const res = await authed(ENDPOINT).send({ longitude: -17.47 });
        expect(res.status).toBe(400);
    });

    it('resolves a July weekday to the summer fallback, targeting TODAY', async () => {
        const res = await authed(ENDPOINT).send({});
        expect(res.status).toBe(200);

        const { dayContext, weather } = res.body.data;
        expect(dayContext).toMatchObject({
            date: '2026-07-13',
            mode: 'home',
            reason: 'default_summer',
            breakLabel: null,
        });
        // Offset 0 → the forecast row for today, not tomorrow.
        expect(weather.date).toBe('2026-07-13');
    });

    it('still fills the card from the static bank when the AI provider is down', async () => {
        const res = await authed(ENDPOINT).send({});
        // Not a 5xx: the AI being down is not a reason to show the user nothing.
        expect(res.status).toBe(200);

        const { activities, aiUnavailable } = res.body.data;
        // The invariant that matters: degraded, but never empty.
        expect(aiUnavailable).toBe(true);
        expect(activities.length).toBeGreaterThanOrEqual(3);

        for (const a of activities) {
            expect(a.kidIds).toContain(KID_ID);
            expect(a.title).toBeTruthy();
            expect(['morning', 'afternoon', 'evening']).toContain(a.timeOfDay);
        }
    });

    it('reports a school day when a declared break ends before the date', async () => {
        // The user declares summer ending 2026-07-10 — so 2026-07-13 is back to
        // school, and the built-in July fallback must step aside.
        queryMock.current = makeQueryMock({
            breaks: [{ label: "Vacances d'été", start_date: '2026-06-20', end_date: '2026-07-10' }],
        });

        const res = await authed(ENDPOINT).send({});
        expect(res.status).toBe(200);
        expect(res.body.data.dayContext.mode).toBe('school');
        expect(res.body.data.dayContext.reason).toBe('school_day');
        // Term time → the dashboard talks about tomorrow.
        expect(res.body.data.weather.date).toBe('2026-07-14');
    });

    it('carries a declared break label through to the client', async () => {
        queryMock.current = makeQueryMock({
            breaks: [
                { label: 'Grandes vacances', start_date: '2026-07-04', end_date: '2026-09-01' },
            ],
        });

        const res = await authed(ENDPOINT).send({});
        expect(res.body.data.dayContext.reason).toBe('school_break');
        expect(res.body.data.dayContext.breakLabel).toBe('Grandes vacances');
    });

    it('returns no activities (and no crash) when the family has no kids', async () => {
        queryMock.current = makeQueryMock({ kids: [] });
        const res = await authed(ENDPOINT).send({});
        expect(res.status).toBe(200);
        expect(res.body.data.activities).toEqual([]);
    });
});
