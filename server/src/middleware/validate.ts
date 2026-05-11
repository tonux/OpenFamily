import type { Request, Response, NextFunction } from 'express';
import { ZodError, ZodTypeAny, z } from 'zod';

// =============================================================================
// Validation middleware
//
// Wraps zod schemas as Express middleware. Replaces the previous patchwork of
// manual `typeof === 'string'` / helper-based parsing with declarative,
// type-safe schemas. The parsed (and coerced) values are written back to the
// request so route handlers can rely on them being correct.
//
// Usage:
//   router.post('/items',
//     validate({ body: itemCreateSchema }),
//     handler,
//   );
//
// On validation failure the middleware returns:
//   { success: false, error: 'Validation failed', details: [{ path, message }] }
// =============================================================================

export interface ValidateOptions {
    body?: ZodTypeAny;
    params?: ZodTypeAny;
    query?: ZodTypeAny;
}

interface ValidationIssue {
    path: string;
    message: string;
}

const formatIssues = (err: ZodError): ValidationIssue[] => {
    // zod 4 exposes issues under `.issues`. Older codebases / examples used
    // `.errors`; we read both to stay forward-compatible.
    const issues = err.issues ?? (err as ZodError & { errors?: ZodError['issues'] }).errors ?? [];
    return issues.flatMap((i) => {
        // `unrecognized_keys` (zod's strict() mode rejection) carries the
        // offending names in `i.keys`, not in `i.path` (which stays at root).
        // Expand each one so callers see the actual field name.
        const maybeKeys = i as { code?: string; keys?: string[] };
        if (maybeKeys.code === 'unrecognized_keys' && Array.isArray(maybeKeys.keys)) {
            return maybeKeys.keys.map((key) => ({
                path: [...i.path, key].join('.'),
                message: i.message,
            }));
        }
        return [
            {
                path: i.path.join('.') || '(root)',
                message: i.message,
            },
        ];
    });
};

export const validate =
    (schemas: ValidateOptions) =>
    (req: Request, res: Response, next: NextFunction): void => {
        try {
            if (schemas.body !== undefined) {
                req.body = schemas.body.parse(req.body);
            }
            if (schemas.params !== undefined) {
                // Express types req.params with ParamsDictionary; the parsed
                // value is structurally compatible (a plain object of strings)
                // so a typed cast is appropriate here.
                const parsed = schemas.params.parse(req.params);
                (req as { params: typeof parsed }).params = parsed;
            }
            if (schemas.query !== undefined) {
                const parsed = schemas.query.parse(req.query);
                (req as { query: typeof parsed }).query = parsed;
            }
            next();
        } catch (err) {
            if (err instanceof ZodError) {
                res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: formatIssues(err),
                });
                return;
            }
            next(err);
        }
    };

// Common, reusable building blocks.
export const uuidSchema = z.string().uuid({ message: 'Expected a UUID' });
export const idParamsSchema = z.object({ id: uuidSchema });
