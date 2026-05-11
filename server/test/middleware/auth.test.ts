import { describe, it, expect, vi } from 'vitest';
import type { Response, Request, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import {
    generateAccessToken,
    generateRefreshToken,
    verifyToken,
    authMiddleware,
    ACCESS_COOKIE_NAME,
    setAuthCookies,
    clearAuthCookies,
    extractRefreshToken,
    REFRESH_COOKIE_NAME,
} from '../../src/middleware/auth';
import { getJwtSecret } from '../../src/config/loadEnv';

const USER_ID = 'd1f7a3c8-9b1e-41d4-a716-446655440000';

describe('access vs refresh tokens', () => {
    it('signs distinct tokens with a kind claim', () => {
        const access = generateAccessToken(USER_ID);
        const refresh = generateRefreshToken(USER_ID);
        expect(access).not.toEqual(refresh);

        const accessPayload = jwt.verify(access, getJwtSecret()) as {
            kind: string;
            userId: string;
        };
        const refreshPayload = jwt.verify(refresh, getJwtSecret()) as {
            kind: string;
            userId: string;
        };

        expect(accessPayload.kind).toBe('access');
        expect(refreshPayload.kind).toBe('refresh');
        expect(accessPayload.userId).toBe(USER_ID);
        expect(refreshPayload.userId).toBe(USER_ID);
    });

    it('verifyToken rejects a token of the wrong kind', () => {
        const refresh = generateRefreshToken(USER_ID);
        // Cross-use must throw — the kind check is the whole point of the
        // two-token model.
        expect(() => verifyToken(refresh, 'access')).toThrow();

        const access = generateAccessToken(USER_ID);
        expect(() => verifyToken(access, 'refresh')).toThrow();
    });

    it('verifyToken returns the payload for a matching kind', () => {
        const access = generateAccessToken(USER_ID);
        const payload = verifyToken(access, 'access');
        expect(payload.userId).toBe(USER_ID);
        expect(payload.kind).toBe('access');
    });
});

describe('authMiddleware token extraction', () => {
    const makeRes = () => {
        const json = vi.fn();
        const status = vi.fn(() => ({ json }));
        return { status, json } as unknown as Response & {
            status: ReturnType<typeof vi.fn>;
            json: ReturnType<typeof vi.fn>;
        };
    };

    it('accepts a valid access token via cookie', () => {
        const token = generateAccessToken(USER_ID);
        const req = {
            headers: {},
            cookies: { [ACCESS_COOKIE_NAME]: token },
        } as unknown as Request & { userId?: string };
        const res = makeRes();
        const next: NextFunction = vi.fn();

        authMiddleware(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(req.userId).toBe(USER_ID);
    });

    it('accepts a valid access token via Authorization header (fallback)', () => {
        const token = generateAccessToken(USER_ID);
        const req = {
            headers: { authorization: `Bearer ${token}` },
            cookies: {},
        } as unknown as Request & { userId?: string };
        const res = makeRes();
        const next: NextFunction = vi.fn();

        authMiddleware(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(req.userId).toBe(USER_ID);
    });

    it('rejects a refresh token used as an access token', () => {
        const refresh = generateRefreshToken(USER_ID);
        const req = {
            headers: {},
            cookies: { [ACCESS_COOKIE_NAME]: refresh },
        } as unknown as Request;
        const res = makeRes();
        const next: NextFunction = vi.fn();

        authMiddleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects when no token is present', () => {
        const req = { headers: {}, cookies: {} } as unknown as Request;
        const res = makeRes();
        const next: NextFunction = vi.fn();

        authMiddleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects a token signed with a different secret', () => {
        const evil = jwt.sign(
            { userId: USER_ID, kind: 'access' },
            'some-other-secret-with-32-chars-min!!!',
        );
        const req = {
            headers: {},
            cookies: { [ACCESS_COOKIE_NAME]: evil },
        } as unknown as Request;
        const res = makeRes();
        const next: NextFunction = vi.fn();

        authMiddleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });
});

describe('cookie helpers', () => {
    const makeRes = () => {
        const cookieCalls: Array<{ name: string; value: string; opts: Record<string, unknown> }> =
            [];
        const clearCalls: Array<{ name: string; opts: Record<string, unknown> }> = [];
        const res = {
            cookie: vi.fn((name: string, value: string, opts: Record<string, unknown>) => {
                cookieCalls.push({ name, value, opts });
                return res;
            }),
            clearCookie: vi.fn((name: string, opts: Record<string, unknown>) => {
                clearCalls.push({ name, opts });
                return res;
            }),
        } as unknown as Response & {
            cookie: ReturnType<typeof vi.fn>;
            clearCookie: ReturnType<typeof vi.fn>;
        };
        return { res, cookieCalls, clearCalls };
    };

    it('setAuthCookies sets httpOnly cookies with correct paths and sameSite', () => {
        const { res, cookieCalls } = makeRes();
        setAuthCookies(res, USER_ID);

        expect(cookieCalls).toHaveLength(2);
        const access = cookieCalls.find((c) => c.name === ACCESS_COOKIE_NAME)!;
        const refresh = cookieCalls.find((c) => c.name === REFRESH_COOKIE_NAME)!;

        expect(access.opts.httpOnly).toBe(true);
        expect(access.opts.sameSite).toBe('lax');
        expect(access.opts.path).toBe('/');

        expect(refresh.opts.httpOnly).toBe(true);
        expect(refresh.opts.sameSite).toBe('strict');
        expect(refresh.opts.path).toBe('/api/auth');

        // The set values are actual JWTs of the expected kind.
        const accessPayload = jwt.verify(access.value, getJwtSecret()) as { kind: string };
        const refreshPayload = jwt.verify(refresh.value, getJwtSecret()) as { kind: string };
        expect(accessPayload.kind).toBe('access');
        expect(refreshPayload.kind).toBe('refresh');
    });

    it('clearAuthCookies clears both cookies with matching paths', () => {
        const { res, clearCalls } = makeRes();
        clearAuthCookies(res);
        expect(clearCalls).toEqual([
            { name: ACCESS_COOKIE_NAME, opts: { path: '/' } },
            { name: REFRESH_COOKIE_NAME, opts: { path: '/api/auth' } },
        ]);
    });

    it('extractRefreshToken returns the refresh cookie value when present', () => {
        const req = { cookies: { [REFRESH_COOKIE_NAME]: 'tok' } } as unknown as Request;
        expect(extractRefreshToken(req)).toBe('tok');
    });

    it('extractRefreshToken returns null when missing or empty', () => {
        expect(extractRefreshToken({ cookies: {} } as unknown as Request)).toBeNull();
        expect(extractRefreshToken({} as unknown as Request)).toBeNull();
        expect(
            extractRefreshToken({ cookies: { [REFRESH_COOKIE_NAME]: '' } } as unknown as Request),
        ).toBeNull();
    });
});
