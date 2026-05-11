import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AIService, classifyShoppingItem, parseShoppingNaturalLanguage } from '../ai/AIService';
import { AiError } from '../ai/errors';
import { classifyShoppingItemBodySchema, parseShoppingNLBodySchema } from '../schemas/ai';
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

export default router;
