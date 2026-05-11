import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetAiConfigCache } from '../../src/ai/config';
import { AIService, setAiProviderForTests } from '../../src/ai/AIService';
import { AiError } from '../../src/ai/errors';
import type { BaseProvider } from '../../src/ai/providers/BaseProvider';
import { resetTokenAccountingCache } from '../../src/ai/tokenAccounting';

// --- DB mock --------------------------------------------------------------
// AIService writes to ai_interactions and (via canSpend) reads from it.
// We mock the query() function to capture writes and serve canned reads.
const queryCalls: Array<{ sql: string; params: unknown[] }> = [];
let usedTokensReturn = 0;

vi.mock('../../src/db', () => ({
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        queryCalls.push({ sql, params });
        if (/SUM\(prompt_tokens \+ completion_tokens\)/i.test(sql)) {
            return { rows: [{ used: usedTokensReturn }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }),
    getClient: vi.fn(),
    default: { query: vi.fn() },
}));

// --- Mock provider --------------------------------------------------------
const makeMockProvider = (overrides: Partial<BaseProvider> = {}): BaseProvider => ({
    name: 'mock',
    chat: vi.fn(async () => ({
        content: 'ok',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop' as const,
        model: 'mock-model',
        latencyMs: 12,
    })),
    health: vi.fn(async () => ({
        ok: true,
        provider: 'mock',
        model: 'mock-model',
        latencyMs: 5,
    })),
    ...overrides,
});

const setEnv = (vars: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
};

const USER = '550e8400-e29b-41d4-a716-446655440000';

beforeEach(() => {
    queryCalls.length = 0;
    usedTokensReturn = 0;
    resetAiConfigCache();
    resetTokenAccountingCache();
    setEnv({
        AI_ENABLED: 'true',
        NVIDIA_API_KEY: 'nvapi-test',
        AI_MODEL_DEFAULT: 'mock-default',
        AI_MODEL_HEAVY: 'mock-heavy',
        AI_MODEL_VISION: 'mock-vision',
        AI_MONTHLY_TOKEN_LIMIT_PER_USER: '1000',
    });
    setAiProviderForTests(makeMockProvider());
});

describe('AIService.health', () => {
    it('reports enabled config plus a live ping', async () => {
        const h = await AIService.health();
        expect(h.enabled).toBe(true);
        expect(h.provider).toBe('nvidia');
        expect(h.modelDefault).toBe('mock-default');
        expect(h.livenessOk).toBe(true);
        expect(typeof h.livenessLatencyMs).toBe('number');
    });

    it('skips the network probe when AI_ENABLED=false', async () => {
        setEnv({ AI_ENABLED: 'false', NVIDIA_API_KEY: '' });
        resetAiConfigCache();
        const probeMock = vi.fn();
        setAiProviderForTests(makeMockProvider({ health: probeMock as any }));

        const h = await AIService.health();
        expect(h.enabled).toBe(false);
        expect(h.livenessOk).toBe(false);
        expect(probeMock).not.toHaveBeenCalled();
    });
});

describe('AIService.chat', () => {
    it('records a successful interaction with token usage', async () => {
        const r = await AIService.chat(
            { messages: [{ role: 'user', content: 'Hi' }], maxTokens: 64 },
            { userId: USER, feature: 'test.echo' },
        );
        expect(r.content).toBe('ok');
        const insertCall = queryCalls.find((c) => c.sql.includes('INSERT INTO ai_interactions'));
        expect(insertCall).toBeDefined();
        // params: [user_id, feature, model, prompt, completion, latency, status, error]
        expect(insertCall!.params[1]).toBe('test.echo');
        expect(insertCall!.params[3]).toBe(10); // prompt
        expect(insertCall!.params[4]).toBe(5); // completion
        expect(insertCall!.params[6]).toBe('success');
    });

    it('rejects when the user has exceeded their monthly quota', async () => {
        usedTokensReturn = 999; // < 1000 limit
        // maxTokens defaults to 1024, so 999 + 1024 > 1000 → quota
        await expect(
            AIService.chat(
                { messages: [{ role: 'user', content: 'Hi' }] },
                { userId: USER, feature: 'test.echo' },
            ),
        ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });

        // A quota-rejection row is logged
        const quotaInsert = queryCalls.find(
            (c) => c.sql.includes('INSERT INTO ai_interactions') && c.params.includes('quota'),
        );
        expect(quotaInsert).toBeDefined();
    });

    it('records errors and re-throws AiError when the provider fails', async () => {
        setAiProviderForTests(
            makeMockProvider({
                chat: vi.fn(async () => {
                    throw new AiError('RATE_LIMITED', 'Slow down');
                }) as any,
            }),
        );

        await expect(
            AIService.chat(
                { messages: [{ role: 'user', content: 'Hi' }], maxTokens: 10 },
                { userId: USER, feature: 'test.echo' },
            ),
        ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

        const errInsert = queryCalls.find(
            (c) => c.sql.includes('INSERT INTO ai_interactions') && c.params.includes('error'),
        );
        expect(errInsert).toBeDefined();
        expect(errInsert!.params[7]).toBe('RATE_LIMITED'); // error_code
    });

    it('honors AI_MONTHLY_TOKEN_LIMIT_PER_USER=0 as unlimited', async () => {
        setEnv({ AI_MONTHLY_TOKEN_LIMIT_PER_USER: '0' });
        resetAiConfigCache();
        usedTokensReturn = 999_999_999;

        const r = await AIService.chat(
            { messages: [{ role: 'user', content: 'Hi' }], maxTokens: 64 },
            { userId: USER, feature: 'test.echo' },
        );
        expect(r.content).toBe('ok'); // not blocked
    });

    it('throws DISABLED when AI is turned off', async () => {
        setEnv({ AI_ENABLED: 'false', NVIDIA_API_KEY: '' });
        resetAiConfigCache();
        setAiProviderForTests(null);

        await expect(
            AIService.chat(
                { messages: [{ role: 'user', content: 'Hi' }] },
                { userId: USER, feature: 'test.echo' },
            ),
        ).rejects.toMatchObject({ code: 'DISABLED' });
    });
});
