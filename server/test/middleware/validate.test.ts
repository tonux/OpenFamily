import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../../src/middleware/validate';

const makeRes = () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    return { res: { status, json } as unknown as Response, statusMock: status, jsonMock: json };
};

describe('validate middleware', () => {
    it('parses, coerces and writes the body back on the request', () => {
        const schema = z
            .object({
                age: z.coerce.number(),
                name: z.string().trim(),
            })
            .strict();
        const req = { body: { age: '42', name: '  Alice  ' } } as Request;
        const { res } = makeRes();
        const next: NextFunction = vi.fn();

        validate({ body: schema })(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(req.body).toEqual({ age: 42, name: 'Alice' });
    });

    it('returns 400 with structured details for invalid body', () => {
        const schema = z.object({ email: z.string().email() }).strict();
        const req = { body: { email: 'not-an-email' } } as Request;
        const { res, statusMock, jsonMock } = makeRes();
        const next: NextFunction = vi.fn();

        validate({ body: schema })(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(statusMock).toHaveBeenCalledWith(400);
        const body = jsonMock.mock.calls[0][0];
        expect(body).toMatchObject({ success: false, error: 'Validation failed' });
        expect(body.details).toEqual([{ path: 'email', message: expect.stringMatching(/email/i) }]);
    });

    it('reports the offending path in nested objects', () => {
        const schema = z
            .object({
                user: z.object({ age: z.number() }),
            })
            .strict();
        const req = { body: { user: { age: 'fifteen' } } } as Request;
        const { res, jsonMock } = makeRes();
        const next: NextFunction = vi.fn();

        validate({ body: schema })(req, res, next);

        expect(next).not.toHaveBeenCalled();
        const body = jsonMock.mock.calls[0][0];
        expect(body.details[0].path).toBe('user.age');
    });

    it('rejects unknown fields when the schema is strict', () => {
        const schema = z.object({ a: z.string() }).strict();
        const req = { body: { a: 'ok', sneaky_extra: 'pwn' } } as Request;
        const { res, statusMock, jsonMock } = makeRes();
        const next: NextFunction = vi.fn();

        validate({ body: schema })(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(statusMock).toHaveBeenCalledWith(400);
        const body = jsonMock.mock.calls[0][0];
        expect(body.details.some((d: { path: string }) => /sneaky_extra/.test(d.path))).toBe(true);
    });

    it('validates params and query independently', () => {
        const schema = z.object({ id: z.string().uuid() }).strict();
        const goodId = '550e8400-e29b-41d4-a716-446655440000';
        const goodReq = { params: { id: goodId } } as unknown as Request;
        const { res: goodRes } = makeRes();
        const goodNext: NextFunction = vi.fn();

        validate({ params: schema })(goodReq, goodRes, goodNext);
        expect(goodNext).toHaveBeenCalledOnce();

        const badReq = { query: { id: 'nope' } } as unknown as Request;
        const { res: badRes, statusMock } = makeRes();
        const badNext: NextFunction = vi.fn();

        validate({ query: schema })(badReq, badRes, badNext);
        expect(badNext).not.toHaveBeenCalled();
        expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('delegates non-zod errors to next()', () => {
        // Build a schema whose parse throws a plain Error (not a ZodError).
        const explodingSchema = {
            parse: () => {
                throw new Error('boom');
            },
        } as unknown as Parameters<typeof validate>[0]['body'];

        const req = { body: {} } as Request;
        const { res } = makeRes();
        const next: NextFunction = vi.fn();

        validate({ body: explodingSchema })(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        const passed = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(passed).toBeInstanceOf(Error);
        expect((passed as Error).message).toBe('boom');
    });
});
