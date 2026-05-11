import { Router } from 'express';
import bcrypt from 'bcrypt';
import { query } from '../db';
import {
    authMiddleware,
    AuthRequest,
    setAuthCookies,
    clearAuthCookies,
    extractRefreshToken,
    verifyToken,
} from '../middleware/auth';
import { validate } from '../middleware/validate';
import { loginBodySchema, registerBodySchema, updateCurrencyBodySchema } from '../schemas/auth';
import { normalizeEmail } from '../lib/normalize';
import logger from '../lib/logger';

// The list of supported currencies now lives in schemas/auth.ts as a zod
// enum (single source of truth) and remains synchronized with
// shared/src/constants.ts SUPPORTED_CURRENCIES.

const router = Router();

router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const result = await query('SELECT id, email, name, currency FROM users WHERE id = $1', [
            req.userId,
        ]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        return res.json({ success: true, data: { user: result.rows[0] } });
    } catch (error) {
        logger.error('auth.get_current_user_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Update the authenticated user's preferred currency.
router.patch(
    '/me/currency',
    authMiddleware,
    validate({ body: updateCurrencyBodySchema }),
    async (req: AuthRequest, res) => {
        try {
            const { currency } = req.body;

            const result = await query(
                'UPDATE users SET currency = $1 WHERE id = $2 RETURNING id, email, name, currency',
                [currency, req.userId],
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }

            return res.json({ success: true, data: { user: result.rows[0] } });
        } catch (error) {
            logger.error('auth.update_currency_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

// Register
router.post('/register', validate({ body: registerBodySchema }), async (req, res) => {
    if (process.env.REGISTRATION_ENABLED === 'false') {
        return res.status(403).json({ success: false, error: 'Registration is disabled' });
    }

    try {
        // Body shape and basic constraints (length, email format) are already
        // enforced by the zod schema; we only re-normalize the email for
        // case-insensitive lookups.
        const { email, password, name } = req.body;
        const normalizedEmail = normalizeEmail(email);

        // Check if user exists
        const existingUser = await query('SELECT id FROM users WHERE LOWER(email) = $1', [
            normalizedEmail,
        ]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'User already exists' });
        }

        // Hash password
        const password_hash = await bcrypt.hash(password, 10);

        // Create user. `currency` is left NULL so the client prompts the user to pick one on first login.
        const result = await query(
            'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, currency',
            [normalizedEmail, password_hash, name],
        );

        const user = result.rows[0];
        setAuthCookies(res, user.id);

        // We intentionally do NOT return the JWT in the body anymore — the
        // tokens live in httpOnly cookies so they can never be exfiltrated by
        // JavaScript (XSS). The client gets only non-sensitive user info.
        res.json({ success: true, data: { user } });
    } catch (error) {
        logger.error('auth.register_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Login
router.post('/login', validate({ body: loginBodySchema }), async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = normalizeEmail(email);

        // Find user
        const result = await query('SELECT * FROM users WHERE LOWER(email) = $1', [
            normalizedEmail,
        ]);
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        // Check password
        const isValid = await bcrypt.compare(password, user.password_hash);

        if (!isValid) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        setAuthCookies(res, user.id);

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    currency: user.currency ?? null,
                },
            },
        });
    } catch (error) {
        logger.error('auth.login_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Issue a fresh access (and refresh) token from a valid refresh cookie.
// Returns 401 if the refresh cookie is missing, invalid, expired, or has the
// wrong `kind` — the client should then send the user back to login.
router.post('/refresh', async (req, res) => {
    try {
        const token = extractRefreshToken(req);
        if (!token) {
            return res.status(401).json({ success: false, error: 'No refresh token' });
        }

        const payload = verifyToken(token, 'refresh');
        // Confirm the user still exists before rotating the session — covers
        // the case where the account was deleted while a refresh token was
        // still in circulation.
        const result = await query('SELECT id FROM users WHERE id = $1', [payload.userId]);
        if (result.rows.length === 0) {
            clearAuthCookies(res);
            return res.status(401).json({ success: false, error: 'User no longer exists' });
        }

        setAuthCookies(res, payload.userId);
        res.json({ success: true });
    } catch {
        clearAuthCookies(res);
        return res.status(401).json({ success: false, error: 'Invalid refresh token' });
    }
});

// Clear auth cookies. Always returns 200 — logout should be idempotent and
// safe to call even when the user has no session.
router.post('/logout', (_req, res) => {
    clearAuthCookies(res);
    res.json({ success: true });
});

export default router;
