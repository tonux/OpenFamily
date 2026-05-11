import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetAiConfigCache } from '../../src/ai/config';
import {
    classifyShoppingItem,
    parseShoppingNaturalLanguage,
    setAiProviderForTests,
} from '../../src/ai/AIService';
import { resetTokenAccountingCache } from '../../src/ai/tokenAccounting';
import type { BaseProvider } from '../../src/ai/providers/BaseProvider';

const USER = '550e8400-e29b-41d4-a716-446655440000';

// -- DB mock --------------------------------------------------------------
// Track every query so we can assert cache reads / writes happened.
const queryCalls: Array<{ sql: string; params: unknown[] }> = [];

// Returned by the next "SELECT/UPDATE" cache lookup. Tests rewrite these to
// simulate cache hit or miss.
let cacheLookupRows: Array<{ output_value: string; model: string }> = [];
let interactionsSumReturn = 0;

vi.mock('../../src/db', () => ({
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        queryCalls.push({ sql, params });
        if (/UPDATE ai_classification_cache/i.test(sql)) {
            return { rows: cacheLookupRows, rowCount: cacheLookupRows.length };
        }
        if (/INSERT INTO ai_classification_cache/i.test(sql)) {
            return { rows: [], rowCount: 1 };
        }
        if (/SUM\(prompt_tokens \+ completion_tokens\)/i.test(sql)) {
            return { rows: [{ used: interactionsSumReturn }], rowCount: 1 };
        }
        if (/INSERT INTO ai_interactions/i.test(sql)) {
            return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }),
    getClient: vi.fn(),
    default: { query: vi.fn() },
}));

const setEnv = (vars: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
};

const makeMockProvider = (chatImpl: BaseProvider['chat']): BaseProvider => ({
    name: 'mock',
    chat: chatImpl,
    health: vi.fn(),
});

const okResponse = (content: string) => ({
    content,
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    finishReason: 'stop' as const,
    model: 'mock-default',
    latencyMs: 12,
});

beforeEach(() => {
    queryCalls.length = 0;
    cacheLookupRows = [];
    interactionsSumReturn = 0;
    resetAiConfigCache();
    resetTokenAccountingCache();
    setEnv({
        AI_ENABLED: 'true',
        NVIDIA_API_KEY: 'nvapi-test',
        AI_MODEL_DEFAULT: 'mock-default',
        AI_MODEL_HEAVY: 'mock-heavy',
        AI_MODEL_VISION: 'mock-vision',
        AI_MONTHLY_TOKEN_LIMIT_PER_USER: '0', // unlimited for these tests
    });
});

describe('classifyShoppingItem', () => {
    it('returns the cached category without calling the model on a hit', async () => {
        cacheLookupRows = [{ output_value: 'Alimentation', model: 'mock-default' }];
        const chat = vi.fn();
        setAiProviderForTests(makeMockProvider(chat));

        const r = await classifyShoppingItem('Lait', { userId: USER });
        expect(r.category).toBe('Alimentation');
        expect(r.cached).toBe(true);
        expect(chat).not.toHaveBeenCalled();

        // Cache lookup query was issued with the normalized key.
        const lookup = queryCalls.find((q) => /UPDATE ai_classification_cache/i.test(q.sql));
        expect(lookup).toBeDefined();
        expect(lookup!.params[1]).toBe('lait');
    });

    it('calls the model on a miss and persists the result', async () => {
        cacheLookupRows = []; // miss
        const chat = vi.fn(async () => okResponse(JSON.stringify({ category: 'Bebe' })));
        setAiProviderForTests(makeMockProvider(chat));

        const r = await classifyShoppingItem('Couches taille 3', { userId: USER });
        expect(r.category).toBe('Bebe');
        expect(r.cached).toBe(false);
        expect(chat).toHaveBeenCalledOnce();

        const insert = queryCalls.find((q) => /INSERT INTO ai_classification_cache/i.test(q.sql));
        expect(insert).toBeDefined();
        expect(insert!.params[2]).toBe('Bebe'); // output_value
    });

    it('falls back gracefully when the model returns an unknown category', async () => {
        const chat = vi.fn(async () => okResponse(JSON.stringify({ category: 'NotAValidCat' })));
        setAiProviderForTests(makeMockProvider(chat));

        await expect(classifyShoppingItem('Lait', { userId: USER })).rejects.toMatchObject({
            code: 'BAD_JSON',
        });
    });

    it('rejects empty input with BAD_REQUEST', async () => {
        await expect(classifyShoppingItem('   ', { userId: USER })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
    });
});

describe('parseShoppingNaturalLanguage', () => {
    it('parses a typical sentence into structured items', async () => {
        const chat = vi.fn(async () =>
            okResponse(
                JSON.stringify({
                    items: [
                        {
                            name: 'lait demi-écrémé',
                            quantity: null,
                            unit: null,
                            category: 'Alimentation',
                        },
                        {
                            name: 'yaourts à la fraise',
                            quantity: 6,
                            unit: null,
                            category: 'Alimentation',
                        },
                    ],
                }),
            ),
        );
        setAiProviderForTests(makeMockProvider(chat));

        const items = await parseShoppingNaturalLanguage(
            'ajoute du lait demi-écrémé et 6 yaourts à la fraise',
            { userId: USER },
        );
        expect(items).toHaveLength(2);
        expect(items[0].name).toBe('lait demi-écrémé');
        expect(items[1].quantity).toBe(6);
        expect(items.every((i) => i.category === 'Alimentation')).toBe(true);
    });

    it('recovers from a model that leaks a leading sentence before the JSON', async () => {
        const chat = vi.fn(async () =>
            okResponse(
                'Voici les articles:\n' +
                    JSON.stringify({
                        items: [
                            { name: 'pain', quantity: 1, unit: null, category: 'Alimentation' },
                        ],
                    }),
            ),
        );
        setAiProviderForTests(makeMockProvider(chat));

        const items = await parseShoppingNaturalLanguage('une baguette', { userId: USER });
        expect(items).toHaveLength(1);
        expect(items[0].name).toBe('pain');
    });

    it('drops malformed items but keeps the well-formed ones', async () => {
        const chat = vi.fn(async () =>
            okResponse(
                JSON.stringify({
                    items: [
                        { name: 'OK', quantity: 2, unit: null, category: 'Alimentation' },
                        { /* missing name */ quantity: 1, category: 'Bebe' },
                        'garbage',
                        { name: '   ', category: 'Autre' }, // empty name
                        { name: 'WithBadCategory', quantity: null, unit: null, category: 'XYZ' },
                    ],
                }),
            ),
        );
        setAiProviderForTests(makeMockProvider(chat));

        const items = await parseShoppingNaturalLanguage('peu importe', { userId: USER });
        expect(items.map((i) => i.name)).toEqual(['OK', 'WithBadCategory']);
        // Unknown category collapsed to "Autre".
        expect(items[1].category).toBe('Autre');
    });

    it('rejects empty text with BAD_REQUEST', async () => {
        await expect(parseShoppingNaturalLanguage('   ', { userId: USER })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
    });

    it('throws BAD_JSON when the response has no items array', async () => {
        const chat = vi.fn(async () => okResponse(JSON.stringify({ foo: 'bar' })));
        setAiProviderForTests(makeMockProvider(chat));

        await expect(
            parseShoppingNaturalLanguage('whatever', { userId: USER }),
        ).rejects.toMatchObject({ code: 'BAD_JSON' });
    });
});
