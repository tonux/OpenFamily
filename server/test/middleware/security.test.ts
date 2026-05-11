import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { isUuid, validateUuidParam } from '../../src/middleware/security';

describe('isUuid', () => {
    it('accepts canonical v4 UUIDs', () => {
        expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
        expect(isUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    });

    it('accepts versions 1 through 5', () => {
        // version nibble is 1..5
        expect(isUuid('550e8400-e29b-11d4-a716-446655440000')).toBe(true); // v1
        expect(isUuid('550e8400-e29b-51d4-a716-446655440000')).toBe(true); // v5
    });

    it('rejects all-zero UUID, wrong version, malformed, and non-strings', () => {
        expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(false); // version nibble = 0
        expect(isUuid('550e8400-e29b-71d4-a716-446655440000')).toBe(false); // v7 not in v1-5
        expect(isUuid('550e8400-e29b-41d4-c716-446655440000')).toBe(false); // wrong variant nibble (must be 8,9,a,b)
        expect(isUuid('not-a-uuid')).toBe(false);
        expect(isUuid('12345')).toBe(false);
        expect(isUuid('')).toBe(false);
        expect(isUuid(null)).toBe(false);
        expect(isUuid(undefined)).toBe(false);
        expect(isUuid(42 as unknown as string)).toBe(false);
    });
});

describe('validateUuidParam', () => {
    const makeRes = () => {
        const json = vi.fn();
        const status = vi.fn(() => ({ json }));
        return { status, json } as unknown as {
            status: ReturnType<typeof vi.fn>;
            json: ReturnType<typeof vi.fn>;
        } & Response;
    };

    it('calls next() for a valid UUID', () => {
        const next: NextFunction = vi.fn();
        const res = makeRes();
        validateUuidParam(
            {} as Request,
            res as Response,
            next,
            '550e8400-e29b-41d4-a716-446655440000',
            'id',
        );
        expect(next).toHaveBeenCalledOnce();
        expect((res as { status: ReturnType<typeof vi.fn> }).status).not.toHaveBeenCalled();
    });

    it('responds 400 with a typed error message for an invalid UUID', () => {
        const next: NextFunction = vi.fn();
        const res = makeRes();
        validateUuidParam({} as Request, res as Response, next, 'not-a-uuid', 'id');
        expect(next).not.toHaveBeenCalled();
        expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(400);
        const jsonArg = (res as { json: ReturnType<typeof vi.fn> }).json.mock.calls[0][0];
        expect(jsonArg).toMatchObject({
            success: false,
            error: expect.stringMatching(/uuid/i),
        });
        expect(jsonArg.error).toContain('id');
    });

    it('includes the param name in the error message', () => {
        const next: NextFunction = vi.fn();
        const res = makeRes();
        validateUuidParam({} as Request, res as Response, next, 'bad', 'recipeId');
        const jsonArg = (res as { json: ReturnType<typeof vi.fn> }).json.mock.calls[0][0];
        expect(jsonArg.error).toContain('recipeId');
    });
});
