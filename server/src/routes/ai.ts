import { Router } from 'express';
import multer from 'multer';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
    AIService,
    classifyShoppingItem,
    parseShoppingNaturalLanguage,
    suggestClothingForKids,
    generateRecipesFromIngredients,
    analyzeWeeklyMeals,
    generateLunchboxIdeas,
    extractBudgetEntryFromReceipt,
    type RecipeMemberInput,
    type PlannedMealLine,
    type LunchboxMemberInput,
} from '../ai/AIService';
import { AiError } from '../ai/errors';
import {
    analyzeWeekMealsBodySchema,
    classifyShoppingItemBodySchema,
    clothingSuggestionsBodySchema,
    generateLunchboxIdeasBodySchema,
    generateRecipesBodySchema,
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

// Multer config for the receipt scanner only — stays in memory, never touches
// disk or MinIO. 5 MB cap is enough for a smartphone JPEG; anything bigger is
// either a misuse or needs downscaling client-side first.
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const RECEIPT_ALLOWED_MIME = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
]);
const RECEIPT_DEFAULT_CATEGORIES = [
    'Alimentation',
    'Santé',
    'Enfants',
    'Maison',
    'Loisirs',
    'Autre',
];
const receiptUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: RECEIPT_MAX_BYTES, files: 1 },
});

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

/**
 * POST /api/ai/recipes/generate
 * Body: { ingredients[], familyMemberIds?[], cuisine?, simple?, maxTimeMinutes?, count? }
 * Returns: { recipes: GeneratedRecipe[], cached, model }
 *
 * The route looks up each requested family member, merges their stored
 * allergies + dietary_preferences into the AI prompt, and calls the heavy
 * model for richer recipe instructions. Allergies are passed as a HARD
 * constraint inside the system prompt; the model is told never to include
 * a banned ingredient.
 *
 * Nothing is persisted by this route — the client previews the 3 recipes
 * and POSTs the chosen one(s) to /api/recipes via the regular create endpoint.
 */
const ageYearsFromBirthDateOpt = (birthDate: unknown): number | undefined => {
    if (!birthDate) return undefined;
    const d = birthDate instanceof Date ? birthDate : new Date(`${birthDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return undefined;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const before =
        now.getMonth() < d.getMonth() ||
        (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
    if (before) age -= 1;
    return Math.max(0, Math.min(120, age));
};

const parseAllergiesText = (raw: unknown): string[] => {
    if (Array.isArray(raw)) {
        return raw.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim());
    }
    if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim());
            }
        } catch {
            // Not JSON — treat as comma-separated.
        }
        return raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return [];
};

const parseDietaryPrefsRow = (raw: unknown): Record<string, unknown> => {
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
        return raw as Record<string, unknown>;
    if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
};

router.post(
    '/recipes/generate',
    validate({ body: generateRecipesBodySchema }),
    async (req: AuthRequest, res) => {
        try {
            const body = req.body as import('../schemas/ai').GenerateRecipesBody;

            // Resolve family members owned by this user. Unknown ids are silently
            // dropped — we don't want to leak whether an id exists in someone
            // else's family.
            let members: RecipeMemberInput[] = [];
            if (body.familyMemberIds && body.familyMemberIds.length > 0) {
                const memberRows = await query(
                    `SELECT name, birth_date, allergies, dietary_preferences
                     FROM family_members
                     WHERE user_id = $1 AND id = ANY($2::uuid[])`,
                    [req.userId, body.familyMemberIds],
                );
                members = memberRows.rows.map((row: any) => {
                    const prefs = parseDietaryPrefsRow(row.dietary_preferences);
                    return {
                        name: row.name as string,
                        ageYears: ageYearsFromBirthDateOpt(row.birth_date),
                        allergies: parseAllergiesText(row.allergies),
                        regime:
                            typeof prefs.regime === 'string' ? (prefs.regime as any) : undefined,
                        spice_level:
                            typeof prefs.spice_level === 'string'
                                ? (prefs.spice_level as any)
                                : undefined,
                        dislikes: Array.isArray(prefs.dislikes)
                            ? (prefs.dislikes as string[])
                            : undefined,
                        favorites: Array.isArray(prefs.favorites)
                            ? (prefs.favorites as string[])
                            : undefined,
                    };
                });
            }

            const result = await generateRecipesFromIngredients(
                {
                    ingredients: body.ingredients,
                    members,
                    cuisine: body.cuisine,
                    simple: body.simple,
                    maxTimeMinutes: body.maxTimeMinutes,
                    count: body.count,
                },
                { userId: req.userId! },
            );

            res.json({ success: true, data: result });
        } catch (error) {
            sendAiError(res, error, 'recipes_generate');
        }
    },
);

/**
 * POST /api/ai/meals/analyze-week
 * Body: { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }
 * Returns: { analysis, mealsAnalyzed, model }
 *
 * Pulls every meal_plan owned by the user in the [start, end] window, joins
 * recipe + family member labels, and asks the heavy model for a structured
 * nutritional verdict + actionable advice. Read-only — nothing is persisted.
 *
 * Returns 200 with `aiUnavailable: true` when AI is degraded (DISABLED /
 * QUOTA_EXCEEDED / BAD_JSON) so the front renders an inline notice without
 * an error banner. Hard failures still go through sendAiError.
 */
router.post(
    '/meals/analyze-week',
    validate({ body: analyzeWeekMealsBodySchema }),
    async (req: AuthRequest, res) => {
        try {
            const body = req.body as import('../schemas/ai').AnalyzeWeekMealsBody;

            const mealsRow = await query(
                `SELECT mp.date, mp.meal_type, mp.custom_meal,
                        r.name as recipe_name, r.category as recipe_category,
                        fm.name as family_member_name
                 FROM meal_plans mp
                 LEFT JOIN recipes r ON mp.recipe_id = r.id
                 LEFT JOIN family_members fm ON mp.family_member_id = fm.id
                 WHERE mp.user_id = $1 AND mp.date >= $2 AND mp.date <= $3
                 ORDER BY mp.date ASC, mp.meal_type ASC`,
                [req.userId, body.startDate, body.endDate],
            );

            // Aggregate eaters by (date, meal_type, label) so the prompt sees a
            // single line "lundi déjeuner: Yassa pour Aïcha, Mamadou" instead of
            // one row per family member.
            const aggregated = new Map<string, { line: PlannedMealLine; eaters: Set<string> }>();
            for (const row of mealsRow.rows as any[]) {
                const dateIso =
                    row.date instanceof Date
                        ? row.date.toISOString().slice(0, 10)
                        : String(row.date).slice(0, 10);
                const label = (row.recipe_name as string | null) ?? row.custom_meal ?? null;
                if (!label) continue; // skip empty cells
                const key = `${dateIso}|${row.meal_type}|${label}`;
                const existing = aggregated.get(key);
                const eaterName =
                    typeof row.family_member_name === 'string'
                        ? row.family_member_name.split(' ')[0]
                        : null;
                if (existing) {
                    if (eaterName) existing.eaters.add(eaterName);
                } else {
                    aggregated.set(key, {
                        line: {
                            date: dateIso,
                            mealType: row.meal_type as string,
                            label,
                            recipeCategory: (row.recipe_category as string | null) ?? null,
                        },
                        eaters: new Set(eaterName ? [eaterName] : []),
                    });
                }
            }

            const meals: PlannedMealLine[] = Array.from(aggregated.values()).map(
                ({ line, eaters }) => ({
                    ...line,
                    eaters: eaters.size > 0 ? Array.from(eaters) : undefined,
                }),
            );

            // Light family summary (kids count) — gives the model context on
            // who's eating without leaking PII.
            const familyRow = await query(
                `SELECT COUNT(*) FILTER (WHERE role = 'Enfant')::int AS kids,
                        COUNT(*)::int AS total
                 FROM family_members WHERE user_id = $1`,
                [req.userId],
            );
            const fam = familyRow.rows[0] as { kids: number; total: number } | undefined;
            const familySummary =
                fam && fam.total > 0
                    ? `famille de ${fam.total} personne${fam.total > 1 ? 's' : ''}` +
                      (fam.kids > 0 ? ` dont ${fam.kids} enfant${fam.kids > 1 ? 's' : ''}` : '')
                    : undefined;

            try {
                const result = await analyzeWeeklyMeals(
                    {
                        weekStartIso: body.startDate,
                        weekEndIso: body.endDate,
                        meals,
                        familySummary,
                    },
                    { userId: req.userId! },
                );
                return res.json({ success: true, data: result });
            } catch (err) {
                if (
                    err instanceof AiError &&
                    (err.code === 'DISABLED' ||
                        err.code === 'QUOTA_EXCEEDED' ||
                        err.code === 'BAD_JSON')
                ) {
                    logger.info('ai.nutrition.degraded', { code: err.code });
                    return res.json({
                        success: true,
                        data: {
                            analysis: null,
                            mealsAnalyzed: meals.length,
                            model: '',
                            aiUnavailable: true,
                            code: err.code,
                        },
                    });
                }
                throw err;
            }
        } catch (error) {
            sendAiError(res, error, 'meals_analyze_week');
        }
    },
);

/**
 * POST /api/ai/lunchbox/generate
 * Body: { availableMains?[], availableFruits?[], availableSnacks?[],
 *         availableDrinks?[], location, familyMemberId?, count?, context? }
 * Returns: { ideas: LunchboxIdea[], cached, model }
 *
 * Same pattern as /recipes/generate: when familyMemberId is provided the
 * server fetches that child's age / allergies / dietary_preferences and merges
 * them into the AI prompt. Allergies are passed as a HARD constraint.
 *
 * The client gets ideas only — nothing is persisted. The user picks one in
 * the UI and the existing /api/meal-plans flow saves the lunchbox.
 */
router.post(
    '/lunchbox/generate',
    validate({ body: generateLunchboxIdeasBodySchema }),
    async (req: AuthRequest, res) => {
        try {
            const body = req.body as import('../schemas/ai').GenerateLunchboxIdeasBody;

            let member: LunchboxMemberInput | undefined;
            if (body.familyMemberId) {
                const memberRows = await query(
                    `SELECT name, birth_date, allergies, dietary_preferences
                     FROM family_members
                     WHERE user_id = $1 AND id = $2`,
                    [req.userId, body.familyMemberId],
                );
                const row = memberRows.rows[0] as
                    | {
                          name: string;
                          birth_date: string | Date | null;
                          allergies: unknown;
                          dietary_preferences: unknown;
                      }
                    | undefined;
                if (row) {
                    const prefs = parseDietaryPrefsRow(row.dietary_preferences);
                    member = {
                        name: row.name,
                        ageYears: ageYearsFromBirthDateOpt(row.birth_date),
                        allergies: parseAllergiesText(row.allergies),
                        regime:
                            typeof prefs.regime === 'string' ? (prefs.regime as any) : undefined,
                        dislikes: Array.isArray(prefs.dislikes)
                            ? (prefs.dislikes as string[])
                            : undefined,
                        favorites: Array.isArray(prefs.favorites)
                            ? (prefs.favorites as string[])
                            : undefined,
                    };
                }
            }

            const result = await generateLunchboxIdeas(
                {
                    availableMains: body.availableMains,
                    availableFruits: body.availableFruits,
                    availableSnacks: body.availableSnacks,
                    availableDrinks: body.availableDrinks,
                    location: body.location,
                    member,
                    count: body.count,
                    notesContext: body.context,
                },
                { userId: req.userId! },
            );

            res.json({ success: true, data: result });
        } catch (error) {
            sendAiError(res, error, 'lunchbox_generate');
        }
    },
);

/**
 * POST /api/ai/budget/scan-receipt
 * Content-Type: multipart/form-data
 * Body: file (single image, ≤ 5 MB, JPEG/PNG/WEBP/HEIC/HEIF)
 * Returns: { extraction: ExtractedReceipt, model: string }
 *
 * The image is held in memory just long enough to be encoded as a base64
 * data URL and sent to the vision model. Nothing is persisted server-side.
 *
 * The user's saved currency is fetched and passed to the model so it knows
 * which currency to disambiguate when several are visible on the ticket.
 */
router.post(
    '/budget/scan-receipt',
    (req, res, next) => {
        receiptUpload.single('file')(req, res, (err: unknown) => {
            if (!err) return next();
            if ((err as { code?: string })?.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({
                    success: false,
                    error: {
                        code: 'FILE_TOO_LARGE',
                        message: `Image trop volumineuse (max ${RECEIPT_MAX_BYTES / (1024 * 1024)} MB)`,
                    },
                });
            }
            logger.warn('ai.scan_receipt_multer_error', {
                error: err instanceof Error ? err.message : String(err),
            });
            return res.status(400).json({ success: false, error: 'Upload error' });
        });
    },
    async (req: AuthRequest, res) => {
        try {
            const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
            if (!file) {
                return res
                    .status(400)
                    .json({ success: false, error: 'Missing "file" multipart field' });
            }
            if (!RECEIPT_ALLOWED_MIME.has(file.mimetype)) {
                return res.status(415).json({
                    success: false,
                    error: {
                        code: 'UNSUPPORTED_MIME',
                        message: `Type d'image non supporté : ${file.mimetype}`,
                    },
                });
            }

            const userRow = await query('SELECT currency FROM users WHERE id = $1', [req.userId]);
            const userCurrency =
                typeof userRow.rows[0]?.currency === 'string'
                    ? (userRow.rows[0].currency as string)
                    : undefined;

            const imageDataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

            const result = await extractBudgetEntryFromReceipt(
                {
                    imageDataUrl,
                    suggestedCategories: RECEIPT_DEFAULT_CATEGORIES,
                    userCurrency,
                },
                { userId: req.userId! },
            );

            res.json({ success: true, data: result });
        } catch (error) {
            sendAiError(res, error, 'budget_scan_receipt');
        }
    },
);

export default router;
