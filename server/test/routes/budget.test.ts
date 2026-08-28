import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// =============================================================================
// Budget statistics + statement coverage.
//
// Two things are worth pinning down here:
//
//   * the `source` filter reaches the SQL — a filter the server silently drops
//     would show statement-only figures that quietly include manual rows, the
//     exact confusion the split exists to remove;
//   * the coverage arithmetic — statement periods close mid-month, so "is
//     August covered?" is interval maths, and getting it wrong paints a green
//     badge over days nobody has evidence for.
//
// The DB is mocked by branching on the SQL text, like the other route tests.
// =============================================================================

const USER_ID = '11111111-1111-4111-8111-111111111111';

interface Capture {
    sql: string;
    params?: unknown[];
}

const captured: Capture[] = [];
let statementRows: Array<Record<string, unknown>> = [];
let sourceRows: Array<Record<string, unknown>> = [];

const makeQueryMock = () =>
    vi.fn(async (sql: string, params?: unknown[]) => {
        captured.push({ sql, params });

        if (/family_owner_id/i.test(sql)) {
            // Auth middleware scope lookup.
            return { rows: [{ family_owner_id: null }] };
        }
        if (/FROM bank_statements s/i.test(sql)) {
            return { rows: statementRows };
        }
        if (/INNER JOIN family_members/i.test(sql)) {
            return { rows: [] };
        }
        if (/GROUP BY source/i.test(sql)) {
            return { rows: sourceRows };
        }
        if (/category_total/i.test(sql)) {
            return { rows: [{ category: 'Alimentation', category_total: '120.50' }] };
        }
        if (/total_expenses/i.test(sql)) {
            return { rows: [{ total_expenses: '120.50', total_income: '0' }] };
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
    queryMock.current = makeQueryMock();
    captured.length = 0;
    statementRows = [];
    sourceRows = [];
});

const authed = (method: 'get' | 'post', path: string) =>
    request(app)
        [method](path)
        .set('Cookie', `${ACCESS_COOKIE_NAME}=${generateAccessToken(USER_ID)}`);

/** A statement row as the coverage query returns it. */
const statement = (over: Partial<Record<string, unknown>> = {}) => ({
    id: '33333333-3333-4333-8333-333333333333',
    issuer: 'Banque X',
    account_label: 'Visa',
    card_last4: '4321',
    currency: 'CAD',
    status: 'imported',
    statement_date: '2026-08-14',
    period_start: '2026-07-15',
    period_end: '2026-08-14',
    total_purchases: '900.00',
    pending_count: 0,
    pending_amount: '0',
    ...over,
});

describe('budget statistics', () => {
    it('requires authentication', async () => {
        const res = await request(app).get('/api/budget/statistics?month=8&year=2026');
        expect(res.status).toBe(401);
    });

    it('rejects an unknown source (400)', async () => {
        const res = await authed('get', '/api/budget/statistics?month=8&year=2026&source=bank');
        expect(res.status).toBe(400);
        expect(res.body.details?.[0]?.path).toBe('source');
    });

    it('rejects a missing period (400)', async () => {
        const res = await authed('get', '/api/budget/statistics?year=2026');
        expect(res.status).toBe(400);
    });

    it('does not filter by source when none is asked for', async () => {
        const res = await authed('get', '/api/budget/statistics?month=8&year=2026');
        expect(res.status).toBe(200);
        expect(res.body.data.source).toBe('all');

        const filtered = captured.filter((c) => /AND source = \$/.test(c.sql));
        expect(filtered).toHaveLength(0);
    });

    it('pushes the source filter into every statistics query', async () => {
        const res = await authed(
            'get',
            '/api/budget/statistics?month=8&year=2026&source=statement',
        );
        expect(res.status).toBe(200);

        // Category, totals and per-member queries — but NOT the bySource split,
        // which has to describe the whole month.
        const filtered = captured.filter((c) => /AND (be\.)?source = \$/.test(c.sql));
        expect(filtered).toHaveLength(3);
        filtered.forEach((c) => expect(c.params).toContain('statement'));

        const split = captured.find((c) => /GROUP BY source/i.test(c.sql));
        expect(split?.sql).not.toMatch(/AND source = \$/);
    });

    it('returns a zeroed provenance split when the month is empty', async () => {
        const res = await authed('get', '/api/budget/statistics?month=8&year=2026');
        expect(res.body.data.bySource).toEqual({
            statement: { expenses: 0, income: 0, entryCount: 0 },
            manual: { expenses: 0, income: 0, entryCount: 0 },
        });
    });

    it('reports the provenance split as numbers', async () => {
        sourceRows = [
            { source: 'statement', expenses: '900.00', income: null, entry_count: 42 },
            { source: 'manual', expenses: '120.50', income: '3000.00', entry_count: 3 },
        ];
        const res = await authed('get', '/api/budget/statistics?month=8&year=2026');
        expect(res.body.data.bySource.statement).toEqual({
            expenses: 900,
            income: 0,
            entryCount: 42,
        });
        expect(res.body.data.bySource.manual.income).toBe(3000);
    });
});

describe('statement coverage', () => {
    it('requires authentication', async () => {
        const res = await request(app).get('/api/statements/coverage?month=8&year=2026');
        expect(res.status).toBe(401);
    });

    it('is not swallowed by the /:id route', async () => {
        const res = await authed('get', '/api/statements/coverage?month=8&year=2026');
        expect(res.status).toBe(200);
    });

    it('reports no known account when nothing was ever imported', async () => {
        const res = await authed('get', '/api/statements/coverage?month=8&year=2026');
        expect(res.body.data.total_accounts).toBe(0);
        expect(res.body.data.days_in_month).toBe(31);
        expect(res.body.data.accounts).toEqual([]);
    });

    it('marks a month only partly covered and names the gap', async () => {
        statementRows = [statement()];
        const res = await authed('get', '/api/statements/coverage?month=8&year=2026');

        const [account] = res.body.data.accounts;
        expect(account.status).toBe('partial');
        // 2026-07-15 → 2026-08-14 clipped to August leaves the 1st to the 14th.
        expect(account.covered_days).toBe(14);
        expect(account.missing_ranges).toEqual([{ start: '2026-08-15', end: '2026-08-31' }]);
        expect(res.body.data.partial_accounts).toBe(1);
    });

    it('treats two consecutive periods as continuous coverage', async () => {
        statementRows = [
            statement(),
            statement({
                id: '44444444-4444-4444-8444-444444444444',
                period_start: '2026-08-15',
                period_end: '2026-09-14',
                statement_date: '2026-09-14',
            }),
        ];
        const res = await authed('get', '/api/statements/coverage?month=8&year=2026');

        const [account] = res.body.data.accounts;
        expect(account.status).toBe('covered');
        expect(account.covered_days).toBe(31);
        expect(account.missing_ranges).toEqual([]);
        expect(res.body.data.covered_accounts).toBe(1);
    });

    it('keeps distinct cards apart and sorts the uncovered one first', async () => {
        statementRows = [
            statement({ period_start: '2026-08-01', period_end: '2026-08-31' }),
            statement({
                id: '55555555-5555-4555-8555-555555555555',
                issuer: 'Caisse Y',
                account_label: 'Chèques',
                card_last4: '9087',
                period_start: '2026-06-01',
                period_end: '2026-06-30',
                statement_date: '2026-06-30',
            }),
        ];
        const res = await authed('get', '/api/statements/coverage?month=8&year=2026');

        expect(res.body.data.total_accounts).toBe(2);
        expect(res.body.data.accounts[0].status).toBe('missing');
        expect(res.body.data.accounts[0].issuer).toBe('Caisse Y');
        expect(res.body.data.accounts[0].last_statement_date).toBe('2026-06-30');
        expect(res.body.data.accounts[1].status).toBe('covered');
    });

    it('claims no coverage for a statement whose period could not be read', async () => {
        statementRows = [statement({ period_start: null, period_end: null })];
        const res = await authed('get', '/api/statements/coverage?month=8&year=2026');

        const [account] = res.body.data.accounts;
        expect(account.status).toBe('missing');
        expect(account.covered_days).toBe(0);
        expect(account.unknown_period_count).toBe(1);
    });

    it('surfaces money still awaiting confirmation', async () => {
        statementRows = [
            statement({ status: 'pending_review', pending_count: 12, pending_amount: '341.75' }),
        ];
        const res = await authed('get', '/api/statements/coverage?month=8&year=2026');

        expect(res.body.data.pending_count).toBe(12);
        expect(res.body.data.pending_amount).toBe(341.75);
        expect(res.body.data.accounts[0].statements[0].pending_amount).toBe(341.75);
    });

    it('ignores a statement that does not touch the month at all', async () => {
        statementRows = [statement({ period_start: '2026-03-01', period_end: '2026-03-31' })];
        const res = await authed('get', '/api/statements/coverage?month=8&year=2026');

        const [account] = res.body.data.accounts;
        expect(account.status).toBe('missing');
        expect(account.statements).toEqual([]);
        expect(account.last_statement_date).toBe('2026-03-31');
    });
});
