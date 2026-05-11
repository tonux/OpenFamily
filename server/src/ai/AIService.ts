// =============================================================================
// AIService — high-level façade
//
// Routes and tools call this, not the provider directly. The service is
// responsible for:
//   - selecting the right model for a given feature
//   - enforcing quotas before issuing the call
//   - recording every interaction in ai_interactions
//   - converting provider errors into the AiError taxonomy
//
// Future feature methods (parseShoppingNL, generateWeeklyMealPlan, …) live
// here so the routes stay thin. PR #1 only exposes health() and a generic
// chat() — enough to validate the plumbing end-to-end.
// =============================================================================
import logger from '../lib/logger';
import { getAiConfig } from './config';
import { AiError } from './errors';
import { NvidiaProvider } from './providers/NvidiaProvider';
import type {
    BaseProvider,
    ChatRequest,
    ChatResponse,
    ProviderHealth,
} from './providers/BaseProvider';
import { canSpend, recordInteraction } from './tokenAccounting';
import { lookupClassification, saveClassification } from './cache';
import {
    SHOPPING_CATEGORIES,
    type ShoppingCategory,
    buildClassifyShoppingItemUserPrompt,
    buildParseShoppingNLUserPrompt,
    classifyShoppingItemSystemPrompt,
    parseShoppingNaturalLanguageSystemPrompt,
} from './prompts/shoppingPrompts';
import {
    type ClothingKidInput,
    buildClothingUserPrompt,
    clothingSuggestionsSystemPrompt,
} from './prompts/clothingPrompts';
import type { WeatherSummary } from '../weather/WeatherService';

let cachedProvider: BaseProvider | null = null;

const getProvider = (): BaseProvider => {
    if (cachedProvider) return cachedProvider;
    const cfg = getAiConfig();
    if (!cfg.enabled) throw new AiError('DISABLED', 'AI feature is disabled');

    switch (cfg.provider) {
        case 'nvidia':
            cachedProvider = new NvidiaProvider({
                apiKey: cfg.nvidia.apiKey,
                baseUrl: cfg.nvidia.baseUrl,
                requestTimeoutMs: cfg.requestTimeoutMs,
                healthModel: cfg.models.default,
            });
            return cachedProvider;
        default:
            // The exhaustiveness is enforced by `provider: 'nvidia'` in AiConfig.
            // This branch exists for future-proofing.
            throw new AiError('PROVIDER_ERROR', `Unsupported AI provider: ${String(cfg.provider)}`);
    }
};

export interface ChatContext {
    userId: string;
    /** Logical feature name for accounting/logging — e.g. "shopping.classify". */
    feature: string;
    /** Override the model that would be picked from config. */
    model?: string;
}

export interface AiHealth {
    enabled: boolean;
    provider: string;
    modelDefault: string;
    modelHeavy: string;
    modelVision: string;
    livenessOk: boolean;
    livenessLatencyMs: number | null;
    livenessDetail?: string;
}

export const AIService = {
    /**
     * Return a snapshot of the AI configuration plus a live ping to the
     * provider. Used by /api/ai/health and by smoke tests. The liveness probe
     * is the only call here that actually hits the network.
     */
    async health(): Promise<AiHealth> {
        const cfg = getAiConfig();
        const base: AiHealth = {
            enabled: cfg.enabled,
            provider: cfg.provider,
            modelDefault: cfg.models.default,
            modelHeavy: cfg.models.heavy,
            modelVision: cfg.models.vision,
            livenessOk: false,
            livenessLatencyMs: null,
        };
        if (!cfg.enabled) return base;

        const probe: ProviderHealth = await getProvider().health();
        return {
            ...base,
            livenessOk: probe.ok,
            livenessLatencyMs: probe.latencyMs,
            livenessDetail: probe.detail,
        };
    },

    /**
     * Generic chat call with quota enforcement, logging and structured errors.
     * PR #1 doesn't expose this through HTTP — it exists so PR #2-5 can build
     * their feature methods on top.
     */
    async chat(
        req: Omit<ChatRequest, 'userId' | 'feature' | 'model'> & { model?: string },
        ctx: ChatContext,
    ): Promise<ChatResponse> {
        const cfg = getAiConfig();
        if (!cfg.enabled) throw new AiError('DISABLED', 'AI feature is disabled');

        const model = ctx.model ?? req.model ?? cfg.models.default;
        const tokensRequested = req.maxTokens ?? 1024;

        const ok = await canSpend(ctx.userId, tokensRequested, cfg.monthlyTokenLimitPerUser);
        if (!ok) {
            await recordInteraction({
                userId: ctx.userId,
                feature: ctx.feature,
                model,
                promptTokens: 0,
                completionTokens: 0,
                latencyMs: null,
                status: 'quota',
                errorCode: 'QUOTA_EXCEEDED',
            });
            throw new AiError('QUOTA_EXCEEDED', 'Monthly AI token quota reached');
        }

        try {
            const response = await getProvider().chat({
                ...req,
                model,
                userId: ctx.userId,
                feature: ctx.feature,
            });
            await recordInteraction({
                userId: ctx.userId,
                feature: ctx.feature,
                model: response.model,
                promptTokens: response.usage.promptTokens,
                completionTokens: response.usage.completionTokens,
                latencyMs: response.latencyMs,
                status: 'success',
            });
            return response;
        } catch (error) {
            const aiError =
                error instanceof AiError
                    ? error
                    : new AiError(
                          'UNKNOWN',
                          error instanceof Error ? error.message : String(error),
                          error,
                      );
            await recordInteraction({
                userId: ctx.userId,
                feature: ctx.feature,
                model,
                promptTokens: 0,
                completionTokens: 0,
                latencyMs: null,
                status: 'error',
                errorCode: aiError.code,
            });
            logger.warn('ai.call_failed', {
                feature: ctx.feature,
                code: aiError.code,
                message: aiError.message,
            });
            throw aiError;
        }
    },
};

// ---------------------------------------------------------------------------
// Feature methods
// ---------------------------------------------------------------------------

const SHOPPING_CLASSIFY_CACHE_SCOPE = 'shopping_classify';

export interface ClassifyShoppingItemResult {
    category: ShoppingCategory;
    cached: boolean;
    model: string;
}

const isShoppingCategory = (s: unknown): s is ShoppingCategory =>
    typeof s === 'string' && (SHOPPING_CATEGORIES as readonly string[]).includes(s);

/**
 * Classify a single shopping item name into one of the supported categories.
 *
 * First consults the deterministic cache; only calls the model on cache miss.
 * After a fresh model call, persists the result so subsequent calls resolve in
 * sub-millisecond time. With normal usage the hit rate exceeds 90% after the
 * first month — the per-foyer OPENAI bill stays in the noise.
 */
export const classifyShoppingItem = async (
    name: string,
    ctx: { userId: string },
): Promise<ClassifyShoppingItemResult> => {
    const trimmed = name.trim();
    if (!trimmed) throw new AiError('BAD_REQUEST', 'name must not be empty');

    const hit = await lookupClassification(SHOPPING_CLASSIFY_CACHE_SCOPE, trimmed);
    if (hit && isShoppingCategory(hit.value)) {
        await recordInteraction({
            userId: ctx.userId,
            feature: 'shopping.classify',
            model: hit.model,
            promptTokens: 0,
            completionTokens: 0,
            latencyMs: null,
            status: 'cached',
        });
        return { category: hit.value, cached: true, model: hit.model };
    }

    const response = await AIService.chat(
        {
            messages: [
                { role: 'system', content: classifyShoppingItemSystemPrompt },
                { role: 'user', content: buildClassifyShoppingItemUserPrompt(trimmed) },
            ],
            temperature: 0,
            maxTokens: 32,
            jsonMode: true,
        },
        { userId: ctx.userId, feature: 'shopping.classify' },
    );

    const parsed = safeParseJson(response.content);
    const candidate = (parsed as { category?: unknown } | null)?.category;
    if (!isShoppingCategory(candidate)) {
        throw new AiError(
            'BAD_JSON',
            `Model returned unexpected category: ${JSON.stringify(candidate)}`,
        );
    }

    await saveClassification(SHOPPING_CLASSIFY_CACHE_SCOPE, trimmed, candidate, response.model);

    return { category: candidate, cached: false, model: response.model };
};

export interface ParsedShoppingItem {
    name: string;
    quantity: number | null;
    unit: string | null;
    category: ShoppingCategory;
}

/**
 * Convert a free-form FR sentence into a list of structured shopping items.
 *
 * The model is forced into JSON mode and the response is zod-shaped at parse
 * time. Items with unknown categories fall back to "Autre" silently — we'd
 * rather create a valid item than refuse the whole batch on one bad category.
 */
export const parseShoppingNaturalLanguage = async (
    text: string,
    ctx: { userId: string },
): Promise<ParsedShoppingItem[]> => {
    const trimmed = text.trim();
    if (!trimmed) throw new AiError('BAD_REQUEST', 'text must not be empty');
    if (trimmed.length > 1000) {
        throw new AiError('BAD_REQUEST', 'text is too long (max 1000 chars)');
    }

    const response = await AIService.chat(
        {
            messages: [
                { role: 'system', content: parseShoppingNaturalLanguageSystemPrompt },
                { role: 'user', content: buildParseShoppingNLUserPrompt(trimmed) },
            ],
            temperature: 0,
            maxTokens: 512,
            jsonMode: true,
        },
        { userId: ctx.userId, feature: 'shopping.parse_nl' },
    );

    const parsed = safeParseJson(response.content);
    const items = (parsed as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) {
        throw new AiError('BAD_JSON', 'Model did not return an "items" array');
    }

    const out: ParsedShoppingItem[] = [];
    for (const raw of items) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const name = typeof r.name === 'string' ? r.name.trim() : '';
        if (!name) continue;
        const quantity =
            typeof r.quantity === 'number' && Number.isFinite(r.quantity) && r.quantity > 0
                ? r.quantity
                : null;
        const unit = typeof r.unit === 'string' && r.unit.trim() ? r.unit.trim() : null;
        const category = isShoppingCategory(r.category) ? r.category : 'Autre';
        out.push({ name, quantity, unit, category });
    }

    return out;
};

const safeParseJson = (content: string | null): unknown => {
    if (!content) {
        throw new AiError('BAD_JSON', 'Empty model response');
    }
    try {
        return JSON.parse(content);
    } catch {
        // Last-ditch attempt: some 8B replies leak a leading sentence before
        // the JSON. Pull the first {…} block out.
        const m = content.match(/\{[\s\S]*\}/);
        if (m) {
            try {
                return JSON.parse(m[0]);
            } catch {
                // fall through
            }
        }
        throw new AiError('BAD_JSON', 'Model response was not valid JSON');
    }
};

// Re-export the type for callers that import from AIService.
export type { ShoppingCategory } from './prompts/shoppingPrompts';

// ---------------------------------------------------------------------------
// Clothing suggestions for kids going to school (dashboard widget)
// ---------------------------------------------------------------------------

export interface ClothingSuggestion {
    kidId: string;
    top: string[];
    bottom: string[];
    footwear: string[];
    accessories: string[];
    advice: string;
}

export interface ClothingSuggestionsResult {
    suggestions: ClothingSuggestion[];
    cached: boolean;
    model: string;
}

const CLOTHING_CACHE_TTL_MS = 30 * 60_000;

interface ClothingCacheEntry {
    at: number;
    /** Suggestions stored without kidId (kidIds are remapped on read). */
    template: Array<Omit<ClothingSuggestion, 'kidId'>>;
    model: string;
}

/**
 * In-memory cache keyed by (weather buckets × age buckets). Two parents in
 * the same city with same-aged kids share an entry — the dashboard refresh
 * costs zero tokens after the first call. Survives only the process; that's
 * fine for v1 (the AI feature is a nice-to-have, not authoritative).
 */
const clothingCache = new Map<string, ClothingCacheEntry>();

const ageBucket = (years: number): string => {
    if (years < 4) return '0-3';
    if (years < 7) return '4-6';
    if (years < 11) return '7-10';
    if (years < 15) return '11-14';
    return '15+';
};

const clothingCacheKey = (weather: WeatherSummary, kids: ClothingKidInput[]): string =>
    [
        weather.tempMinBucket,
        weather.precipBucket,
        weather.windyBucket,
        kids.map((k) => ageBucket(k.ageYears)).join(','),
    ].join('|');

const stringArray = (raw: unknown, max: number): string[] => {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const v of raw) {
        if (out.length >= max) break;
        if (typeof v !== 'string') continue;
        const trimmed = v.trim();
        if (trimmed) out.push(trimmed);
    }
    return out;
};

const sanitizeSuggestion = (raw: unknown, fallbackKidId: string): ClothingSuggestion | null => {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const kidId = typeof r.kidId === 'string' && r.kidId.trim() ? r.kidId.trim() : fallbackKidId;
    const advice = typeof r.advice === 'string' ? r.advice.trim().slice(0, 200) : '';
    return {
        kidId,
        top: stringArray(r.top, 3),
        bottom: stringArray(r.bottom, 3),
        footwear: stringArray(r.footwear, 2),
        accessories: stringArray(r.accessories, 4),
        advice,
    };
};

/**
 * Generate a per-kid clothing suggestion for tomorrow morning. The AI sees
 * a bucketed weather summary plus each kid's age and (private to the request)
 * id; it returns one suggestion per kid in the same order.
 *
 * Caches by (weather buckets × age buckets) for 30 minutes. On a hit we
 * remap the cached template to the current kidIds so the response always
 * lines up with what the caller passed in.
 */
export const suggestClothingForKids = async (
    weather: WeatherSummary,
    kids: ClothingKidInput[],
    ctx: { userId: string },
): Promise<ClothingSuggestionsResult> => {
    if (kids.length === 0) {
        return { suggestions: [], cached: false, model: '' };
    }

    const key = clothingCacheKey(weather, kids);
    const now = Date.now();
    const hit = clothingCache.get(key);
    if (hit && now - hit.at < CLOTHING_CACHE_TTL_MS && hit.template.length === kids.length) {
        await recordInteraction({
            userId: ctx.userId,
            feature: 'dashboard.clothing_suggest',
            model: hit.model,
            promptTokens: 0,
            completionTokens: 0,
            latencyMs: null,
            status: 'cached',
        });
        const suggestions = hit.template.map((tpl, i) => ({ ...tpl, kidId: kids[i].id }));
        return { suggestions, cached: true, model: hit.model };
    }

    const response = await AIService.chat(
        {
            messages: [
                { role: 'system', content: clothingSuggestionsSystemPrompt },
                { role: 'user', content: buildClothingUserPrompt(weather, kids) },
            ],
            temperature: 0.4,
            maxTokens: 600,
            jsonMode: true,
        },
        { userId: ctx.userId, feature: 'dashboard.clothing_suggest' },
    );

    const parsed = safeParseJson(response.content);
    const rawList = (parsed as { suggestions?: unknown } | null)?.suggestions;
    if (!Array.isArray(rawList)) {
        throw new AiError('BAD_JSON', 'Model did not return a "suggestions" array');
    }

    // Build a map by kidId for resilience: the model occasionally reorders.
    const byId = new Map<string, ClothingSuggestion>();
    for (let i = 0; i < rawList.length; i += 1) {
        const fallback = kids[i]?.id ?? '';
        const sanitized = sanitizeSuggestion(rawList[i], fallback);
        if (sanitized) byId.set(sanitized.kidId, sanitized);
    }

    const suggestions: ClothingSuggestion[] = kids.map(
        (k) =>
            byId.get(k.id) ?? {
                kidId: k.id,
                top: [],
                bottom: [],
                footwear: [],
                accessories: [],
                advice: '',
            },
    );

    // Store template (no kidId) so it survives across kids with the same age
    // bucket distribution.
    clothingCache.set(key, {
        at: now,
        template: suggestions.map(({ kidId: _kidId, ...rest }) => rest),
        model: response.model,
    });

    return { suggestions, cached: false, model: response.model };
};

/** Test helper: clears the in-memory clothing-suggestion cache. */
export const _resetClothingCache = (): void => {
    clothingCache.clear();
};

/** Exposed for tests that swap in a mock provider. */
export const setAiProviderForTests = (provider: BaseProvider | null): void => {
    cachedProvider = provider;
};
