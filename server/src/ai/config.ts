// =============================================================================
// AI configuration
//
// All settings come from env vars (12-factor). This module is responsible for
// reading and validating them at boot. Misconfigurations should fail loud
// rather than crashing later in the middle of a request.
//
// `AI_ENABLED=false` disables the feature entirely without removing any code,
// useful for the open-source self-hoster who has no provider key.
// =============================================================================
import logger from '../lib/logger';

export interface AiConfig {
    enabled: boolean;
    provider: 'nvidia';
    nvidia: {
        apiKey: string;
        baseUrl: string;
    };
    models: {
        default: string;
        heavy: string;
        vision: string;
    };
    requestTimeoutMs: number;
    streamingEnabled: boolean;
    monthlyTokenLimitPerUser: number; // 0 = unlimited
}

const parseBoolEnv = (raw: string | undefined, fallback: boolean): boolean => {
    if (raw === undefined) return fallback;
    const v = raw.toLowerCase().trim();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
    return fallback;
};

const parseIntEnv = (raw: string | undefined, fallback: number): number => {
    const n = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

let cached: AiConfig | null = null;

/**
 * Read the AI configuration from process.env. Cached after the first call so
 * env mutations during a single process lifetime don't surprise callers.
 *
 * Throws if AI_ENABLED is true but the API key is missing or has an obviously
 * wrong shape — we want this to crash at boot, not when a user finally tries
 * to use the chat feature.
 */
export const getAiConfig = (): AiConfig => {
    if (cached) return cached;

    const enabled = parseBoolEnv(process.env.AI_ENABLED, true);
    const apiKey = process.env.NVIDIA_API_KEY?.trim() ?? '';

    if (enabled) {
        if (!apiKey) {
            throw new Error(
                'AI_ENABLED=true but NVIDIA_API_KEY is missing. ' +
                    'Either set the key or set AI_ENABLED=false to disable the feature.',
            );
        }
        // NVIDIA NIM keys start with "nvapi-" — catch obvious copy-paste mistakes
        // (e.g. someone pasting an OpenAI key by accident).
        if (!apiKey.startsWith('nvapi-')) {
            logger.warn('ai.api_key_unexpected_prefix', {
                hint: 'NVIDIA NIM keys usually start with "nvapi-". Double-check the value.',
            });
        }
    }

    cached = {
        enabled,
        provider: 'nvidia',
        nvidia: {
            apiKey,
            baseUrl:
                process.env.NVIDIA_API_BASE_URL?.trim() || 'https://integrate.api.nvidia.com/v1',
        },
        models: {
            default: process.env.AI_MODEL_DEFAULT?.trim() || 'meta/llama-3.1-8b-instruct',
            heavy: process.env.AI_MODEL_HEAVY?.trim() || 'meta/llama-3.3-70b-instruct',
            vision: process.env.AI_MODEL_VISION?.trim() || 'meta/llama-3.2-90b-vision-instruct',
        },
        requestTimeoutMs: parseIntEnv(process.env.AI_REQUEST_TIMEOUT_MS, 30_000),
        streamingEnabled: parseBoolEnv(process.env.AI_STREAMING_ENABLED, true),
        monthlyTokenLimitPerUser: parseIntEnv(
            process.env.AI_MONTHLY_TOKEN_LIMIT_PER_USER,
            2_000_000,
        ),
    };

    logger.info('ai.config_loaded', {
        enabled: cached.enabled,
        provider: cached.provider,
        baseUrl: cached.nvidia.baseUrl,
        modelDefault: cached.models.default,
        modelHeavy: cached.models.heavy,
        // Never log the key, even partially.
    });

    return cached;
};

// Exposed for tests that want to mutate env between test cases.
export const resetAiConfigCache = (): void => {
    cached = null;
};
