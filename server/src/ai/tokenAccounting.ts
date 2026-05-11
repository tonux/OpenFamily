// =============================================================================
// Per-user monthly token accounting
//
// Every successful AI call appends a row to `ai_interactions`. Before issuing
// a call we sum the user's total for the current calendar month and refuse if
// they've crossed the configured cap.
//
// A short in-process cache (60s) keeps this from becoming a hot read for
// chatty users — the worst case is they momentarily overshoot the quota by
// whatever they spent in the last minute, which is acceptable.
// =============================================================================
import { query } from '../db';

interface CacheEntry {
    value: number;
    expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/**
 * Total tokens consumed by `userId` since the first day of the current month
 * (calendar month, server timezone). Cached for 60 s to avoid hammering pg
 * during chat sessions.
 */
export const tokensUsedThisMonth = async (userId: string): Promise<number> => {
    const now = Date.now();
    const cached = cache.get(userId);
    if (cached && cached.expiresAt > now) return cached.value;

    const result = await query(
        `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS used
         FROM ai_interactions
         WHERE user_id = $1
           AND date_trunc('month', created_at) = date_trunc('month', NOW())
           AND status = 'success'`,
        [userId],
    );

    const used = Number(result.rows[0]?.used ?? 0);
    cache.set(userId, { value: used, expiresAt: now + CACHE_TTL_MS });
    return used;
};

/**
 * True if `userId` has at least `tokensRequested` tokens of headroom left in
 * the month. When `monthlyLimit` is 0 the limit is treated as unlimited.
 */
export const canSpend = async (
    userId: string,
    tokensRequested: number,
    monthlyLimit: number,
): Promise<boolean> => {
    if (monthlyLimit <= 0) return true;
    const used = await tokensUsedThisMonth(userId);
    return used + tokensRequested <= monthlyLimit;
};

interface RecordOptions {
    userId: string;
    feature: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number | null;
    status: 'success' | 'error' | 'cached' | 'quota';
    errorCode?: string;
}

/**
 * Append an `ai_interactions` row. Always call this after a model interaction
 * (success or failure) — both for observability and to feed the quota cache.
 *
 * Cache invalidation: any successful spend invalidates the cached `used`
 * counter so subsequent canSpend() calls see the fresh value.
 */
export const recordInteraction = async (opts: RecordOptions): Promise<void> => {
    await query(
        `INSERT INTO ai_interactions
            (user_id, feature, model, prompt_tokens, completion_tokens, latency_ms, status, error_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
            opts.userId,
            opts.feature,
            opts.model,
            opts.promptTokens,
            opts.completionTokens,
            opts.latencyMs,
            opts.status,
            opts.errorCode ?? null,
        ],
    );
    if (opts.status === 'success') cache.delete(opts.userId);
};

/** Exposed for tests that need a clean slate between cases. */
export const resetTokenAccountingCache = (): void => {
    cache.clear();
};
