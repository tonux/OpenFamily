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
import { normalizeEmail } from '../lib/normalize';

// Must stay in sync with shared/src/constants.ts SUPPORTED_CURRENCIES.
const SUPPORTED_CURRENCY_CODES = new Set([
    'EUR',
    'USD',
    'GBP',
    'CHF',
    'CAD',
    'JPY',
    'CNY',
    'AUD',
    'XOF',
    'XAF',
    'MAD',
    'TND',
    'DZD',
    'BRL',
    'INR',
]);

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
        console.error('Get current user error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Update the authenticated user's preferred currency.
router.patch('/me/currency', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { currency } = req.body ?? {};
        if (typeof currency !== 'string' || !SUPPORTED_CURRENCY_CODES.has(currency)) {
            return res.status(400).json({ success: false, error: 'Unsupported currency' });
        }

        const result = await query(
            'UPDATE users SET currency = $1 WHERE id = $2 RETURNING id, email, name, currency',
            [currency, req.userId],
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        return res.json({ success: true, data: { user: result.rows[0] } });
    } catch (error) {
        console.error('Update currency error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Register
router.post('/register', async (req, res) => {
    if (process.env.REGISTRATION_ENABLED === 'false') {
        return res.status(403).json({ success: false, error: 'Registration is disabled' });
    }

    try {
        const { email, password, name } = req.body;
        const normalizedEmail = typeof email === 'string' ? normalizeEmail(email) : '';
        const cleanedName = typeof name === 'string' ? name.trim() : '';

        if (!normalizedEmail || !password || !cleanedName) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        if (password.length < 8) {
            return res
                .status(400)
                .json({ success: false, error: 'Password must be at least 8 characters' });
        }

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
            [normalizedEmail, password_hash, cleanedName],
        );

        const user = result.rows[0];
        setAuthCookies(res, user.id);

        // We intentionally do NOT return the JWT in the body anymore — the
        // tokens live in httpOnly cookies so they can never be exfiltrated by
        // JavaScript (XSS). The client gets only non-sensitive user info.
        res.json({ success: true, data: { user } });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = typeof email === 'string' ? normalizeEmail(email) : '';

        if (!normalizedEmail || !password) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

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
        console.error('Login error:', error);
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
