import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
    AIService,
    classifyShoppingItem,
    parseShoppingNaturalLanguage,
    suggestClothingForKids,
} from '../ai/AIService';
import { AiError } from '../ai/errors';
import {
    classifyShoppingItemBodySchema,
    clothingSuggestionsBodySchema,
    parseShoppingNLBodySchema,
} from '../schemas/ai';
import { query } from '../db';
import { getTomorrowForecast, summarize } from '../weather/WeatherService';
import { WeatherError } from '../weather/errors';
import logger from '../lib/logger';

const router = Router();

// All AI routes require authentication. PR #1 only exposes /health — we wire
// auth here so future PRs (#17-#20) can add features without re-thinking it.
router.use(authMiddleware);

const sendAiError = (res: import('express').Response, error: unknown, feature: string): void => {
    if (error instanceof AiError) {
        logger.warn(`ai.${feature}_failed`, { code: error.code, message: error.message });
        res.status(error.status).json({ success: false, error: error.toJSON() });
        return;
    }
    logger.error(`ai.${feature}_unexpected`, {
        error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ success: false, error: 'Internal server error' });
};

/**
 * GET /api/ai/health
 *
 * Returns:
 *   200 — JSON describing the AI config and the result of a live ping
 *   503 — when AI is disabled in config (still returns JSON, never throws)
 *
 * This endpoint touches the network: the provider is pinged with a 1-token
 * completion. Use sparingly in monitoring — it's NOT free.
 */
router.get('/health', async (_req: AuthRequest, res) => {
    try {
        const health = await AIService.health();
        const status = health.enabled ? 200 : 503;
        res.status(status).json({ success: health.enabled, data: health });
    } catch (error) {
        sendAiError(res, error, 'health');
    }
});

/**
 * POST /api/ai/shopping/classify
 * Body: { name: string }
 * Returns: { category, cached, model }
 *
 * Cache-first: most calls cost zero tokens after the first time the name is
 * seen across the whole instance. Safe to call from auto-suggest at every
 * blur — debounce only for UX.
 */
router.post(
    '/shopping/classify',
    validate({ body: classifyShoppingItemBodySchema }),
    async (req: AuthRequest, res) => {
        try {
            const data = await classifyShoppingItem(req.body.name, { userId: req.userId! });
            res.json({ success: true, data });
        } catch (error) {
            sendAiError(res, error, 'shopping_classify');
        }
    },
);

/**
 * POST /api/ai/shopping/parse
 * Body: { text: string }
 * Returns: { items: ParsedShoppingItem[] }
 *
 * The client gets a preview; nothing is inserted in the DB by this route.
 * Confirmation lives on the client (a list of checkboxes) and a final batch
 * insert via POST /api/shopping/. This keeps the IA layer free of write
 * side-effects on the shopping module.
 */
router.post(
    '/shopping/parse',
    validate({ body: parseShoppingNLBodySchema }),
    async (req: AuthRequest, res) => {
        try {
            const items = await parseShoppingNaturalLanguage(req.body.text, {
                userId: req.userId!,
            });
            res.json({ success: true, data: { items } });
        } catch (error) {
            sendAiError(res, error, 'shopping_parse');
        }
    },
);

/**
 * POST /api/ai/dashboard/clothing-suggestions
 * Body: { latitude?: number, longitude?: number }   (override coords)
 *
 * Aggregates tomorrow's forecast for the user's saved (or overridden) city,
 * the list of children, and an AI-generated clothing suggestion per child.
 *
 * Degraded paths return 200 with a typed `code` so the widget can render a
 * partial state without an error banner:
 *   - NO_LOCATION   → user has no city saved and no override sent
 *   - DISABLED      → AI feature toggle off; weather + kids still returned
 *   - QUOTA_EXCEEDED→ same
 *   - BAD_JSON      → model returned garbage; weather + kids still returned
 * Hard failures (weather provider down, etc.) bubble through `sendAiError`.
 */
const ageYearsFromBirthDate = (birthDate: unknown, fallback: number): number => {
    if (!(birthDate instanceof Date) && typeof birthDate !== 'string') return fallback;
    const d = birthDate instanceof Date ? birthDate : new Date(`${birthDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return fallback;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const before =
        now.getMonth() < d.getMonth() ||
        (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
    if (before) age -= 1;
    return Math.max(0, Math.min(120, age));
};

router.post(
    '/dashboard/clothing-suggestions',
    validate({ body: clothingSuggestionsBodySchema }),
    async (req: AuthRequest, res) => {
        try {
            // 1. Resolve coordinates: override > saved.
            let latitude: number | null =
                typeof req.body.latitude === 'number' ? req.body.latitude : null;
            let longitude: number | null =
                typeof req.body.longitude === 'number' ? req.body.longitude : null;
            let cityLabel: string | null = null;

            const userRow = await query(
                'SELECT city, latitude, longitude FROM users WHERE id = $1',
                [req.userId],
            );
            const u = userRow.rows[0] as
                | {
                      city: string | null;
                      latitude: string | number | null;
                      longitude: string | number | null;
                  }
                | undefined;

            if (latitude === null || longitude === null) {
                if (u && u.latitude !== null && u.longitude !== null) {
                    latitude = Number(u.latitude);
                    longitude = Number(u.longitude);
                    cityLabel = u.city ?? null;
                } else {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'NO_LOCATION', message: 'No saved location' },
                    });
                }
            }

            // 2. Forecast.
            let weather;
            let summary;
            try {
                weather = await getTomorrowForecast(latitude!, longitude!);
                summary = summarize(weather);
            } catch (err) {
                if (err instanceof WeatherError) {
                    logger.warn('ai.clothing.weather_failed', {
                        code: err.code,
                        message: err.message,
                    });
                    return res.status(err.status).json({ success: false, error: err.toJSON() });
                }
                throw err;
            }

            // 3. Kids (role='Enfant').
            const kidsRow = await query(
                `SELECT id, name, birth_date, color
                 FROM family_members
                 WHERE user_id = $1 AND role = 'Enfant'
                 ORDER BY birth_date NULLS LAST, name ASC`,
                [req.userId],
            );
            const kids = kidsRow.rows.map((r: any) => ({
                id: r.id as string,
                name: r.name as string,
                color: r.color as string,
                birth_date: r.birth_date as string | null,
                ageYears: ageYearsFromBirthDate(r.birth_date, 8),
            }));

            const baseResponse = {
                weather,
                city: cityLabel,
                kids,
            };

            if (kids.length === 0) {
                return res.json({
                    success: true,
                    data: { ...baseResponse, suggestions: [], cached: false, model: '' },
                });
            }

            // 4. AI suggestion. Degrade gracefully on disabled/quota/bad-json.
            try {
                const ai = await suggestClothingForKids(
                    summary,
                    kids.map((k) => ({
                        id: k.id,
                        firstName: k.name.split(' ')[0] ?? k.name,
                        ageYears: k.ageYears,
                    })),
                    { userId: req.userId! },
                );
                return res.json({
                    success: true,
                    data: {
                        ...baseResponse,
                        suggestions: ai.suggestions,
                        cached: ai.cached,
                        model: ai.model,
                    },
                });
            } catch (err) {
                if (
                    err instanceof AiError &&
                    (err.code === 'DISABLED' ||
                        err.code === 'QUOTA_EXCEEDED' ||
                        err.code === 'BAD_JSON')
                ) {
                    logger.info('ai.clothing.degraded', { code: err.code });
                    return res.json({
                        success: true,
                        data: {
                            ...baseResponse,
                            suggestions: [],
                            cached: false,
                            model: '',
                            aiUnavailable: true,
                            code: err.code,
                        },
                    });
                }
                throw err;
            }
        } catch (error) {
            sendAiError(res, error, 'dashboard_clothing');
        }
    },
);

export default router;
