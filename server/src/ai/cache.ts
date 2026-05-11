// =============================================================================
// Deterministic classification cache (table `ai_classification_cache`)
//
// For features whose output is stable over time — typing "lait" should always
// return "Alimentation" — we hit the model only on the FIRST occurrence per
// scope/input pair. Subsequent requests resolve in ~1 ms from the DB.
//
// `scope` partitions the cache by feature (e.g. "shopping_classify",
// "budget_classify"). `input_normalized` is what we look up against — callers
// should normalize before hand-off so "Lait" / "lait " / "LAIT" all collide.
// =============================================================================
import { query } from '../db';

export const normalizeCacheKey = (raw: string): string =>
    raw.toLowerCase().trim().replace(/\s+/g, ' ');

export interface CacheLookupResult {
    value: string;
    model: string;
}

/**
 * Try to resolve `input` from cache. Returns null on miss. Increments the
 * `hits` counter so we can later see what's hot.
 */
export const lookupClassification = async (
    scope: string,
    input: string,
): Promise<CacheLookupResult | null> => {
    const key = normalizeCacheKey(input);
    if (!key) return null;

    const result = await query(
        `UPDATE ai_classification_cache
            SET hits = hits + 1
          WHERE scope = $1 AND input_normalized = $2
        RETURNING output_value, model`,
        [scope, key],
    );

    const row = result.rows[0];
    if (!row) return null;
    return { value: row.output_value, model: row.model };
};

/**
 * Persist a fresh classification. ON CONFLICT updates only the `hits` counter
 * so a race between two writers doesn't overwrite an existing value.
 */
export const saveClassification = async (
    scope: string,
    input: string,
    value: string,
    model: string,
): Promise<void> => {
    const key = normalizeCacheKey(input);
    if (!key || !value) return;

    await query(
        `INSERT INTO ai_classification_cache (scope, input_normalized, output_value, model)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (scope, input_normalized) DO UPDATE
            SET hits = ai_classification_cache.hits + 1`,
        [scope, key, value, model],
    );
};
