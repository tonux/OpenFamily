import type { Request, Response, NextFunction } from 'express';

// Canonical UUID v1-v5 format. The full pattern is intentionally strict to
// reject lookalikes (e.g. all-zeros, missing version nibble) and avoid the
// 500 PostgreSQL errors that occur when a malformed string is passed as a
// uuid-typed parameter.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
    typeof value === 'string' && UUID_REGEX.test(value);

/**
 * Express param handler that rejects requests whose `:id` (or other named
 * UUID-typed param) does not match a canonical UUID. Registered via
 * `app.param('id', validateUuidParam)` so every route that uses `:id` benefits
 * automatically.
 *
 * Returning 400 here instead of letting the request reach the route handler
 * avoids leaking PostgreSQL error messages and 500 status codes for what is,
 * semantically, a client error.
 */
export const validateUuidParam = (
    req: Request,
    res: Response,
    next: NextFunction,
    value: string,
    name: string,
) => {
    if (isUuid(value)) {
        next();
        return;
    }
    res.status(400).json({
        success: false,
        error: `Invalid ${name}: expected a UUID`,
    });
};
