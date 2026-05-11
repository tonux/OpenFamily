import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NvidiaProvider } from '../../src/ai/providers/NvidiaProvider';
import { AiError } from '../../src/ai/errors';

const baseOpts = {
    apiKey: 'nvapi-test-key',
    baseUrl: 'https://example.test/v1',
    requestTimeoutMs: 200,
    healthModel: 'meta/llama-3.1-8b-instruct',
};

const mockFetch = (impl: typeof fetch) => {
    vi.stubGlobal('fetch', impl as unknown as typeof fetch);
};

const okBody = (overrides: object = {}) => ({
    id: 'cmpl-123',
    model: 'meta/llama-3.1-8b-instruct',
    choices: [
        {
            index: 0,
            message: { role: 'assistant', content: 'pong', tool_calls: undefined },
            finish_reason: 'stop',
        },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    ...overrides,
});

describe('NvidiaProvider.chat', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('translates ChatRequest into an OpenAI-compatible body and parses the response', async () => {
        const seen: Record<string, unknown> = {};
        mockFetch(async (_url: any, init: any) => {
            seen.headers = init.headers;
            seen.body = JSON.parse(init.body);
            return new Response(JSON.stringify(okBody()), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });

        const provider = new NvidiaProvider(baseOpts);
        const resp = await provider.chat({
            model: 'meta/llama-3.1-8b-instruct',
            messages: [{ role: 'user', content: 'Hi' }],
            maxTokens: 64,
            jsonMode: true,
            userId: 'u1',
            feature: 'test.echo',
        });

        // Body shape
        const body = seen.body as Record<string, unknown>;
        expect(body.model).toBe('meta/llama-3.1-8b-instruct');
        expect(body.max_tokens).toBe(64);
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);

        // Authorization header
        const headers = seen.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer nvapi-test-key');

        // Parsed response
        expect(resp.content).toBe('pong');
        expect(resp.finishReason).toBe('stop');
        expect(resp.usage.totalTokens).toBe(7);
        expect(resp.toolCalls).toEqual([]);
    });

    it('maps 401 to UNAUTHORIZED without retrying', async () => {
        let calls = 0;
        mockFetch(async () => {
            calls++;
            return new Response('bad key', { status: 401 });
        });

        const provider = new NvidiaProvider(baseOpts);
        await expect(
            provider.chat({
                model: 'm',
                messages: [{ role: 'user', content: 'x' }],
                userId: 'u',
                feature: 'f',
            }),
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        expect(calls).toBe(1); // 4xx is not retried
    });

    it('retries on 5xx and recovers if a later attempt succeeds', async () => {
        let calls = 0;
        mockFetch(async () => {
            calls++;
            if (calls < 2) return new Response('boom', { status: 502 });
            return new Response(JSON.stringify(okBody()), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });

        const provider = new NvidiaProvider(baseOpts);
        const resp = await provider.chat({
            model: 'm',
            messages: [{ role: 'user', content: 'x' }],
            userId: 'u',
            feature: 'f',
        });
        expect(resp.content).toBe('pong');
        expect(calls).toBe(2);
    });

    it('maps repeated 5xx to PROVIDER_ERROR after retries', async () => {
        mockFetch(async () => new Response('boom', { status: 502 }));
        const provider = new NvidiaProvider({ ...baseOpts, requestTimeoutMs: 50 });
        await expect(
            provider.chat({
                model: 'm',
                messages: [{ role: 'user', content: 'x' }],
                userId: 'u',
                feature: 'f',
            }),
        ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    }, 10_000);

    it('throws PROVIDER_ERROR when the response has no choices', async () => {
        mockFetch(
            async () =>
                new Response(JSON.stringify({ choices: [], usage: {} }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
        );
        const provider = new NvidiaProvider(baseOpts);
        await expect(
            provider.chat({
                model: 'm',
                messages: [{ role: 'user', content: 'x' }],
                userId: 'u',
                feature: 'f',
            }),
        ).rejects.toBeInstanceOf(AiError);
    });
});

describe('NvidiaProvider.health', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('returns ok=true on a successful ping', async () => {
        mockFetch(
            async () =>
                new Response(JSON.stringify(okBody()), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
        );
        const provider = new NvidiaProvider(baseOpts);
        const h = await provider.health();
        expect(h.ok).toBe(true);
        expect(h.provider).toBe('nvidia');
        expect(h.model).toBe(baseOpts.healthModel);
        expect(typeof h.latencyMs).toBe('number');
    });

    it('returns ok=false with detail on failure', async () => {
        mockFetch(async () => new Response('nope', { status: 401 }));
        const provider = new NvidiaProvider(baseOpts);
        const h = await provider.health();
        expect(h.ok).toBe(false);
        expect(h.detail).toMatch(/401/);
    });
});
