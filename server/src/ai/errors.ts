// =============================================================================
// Typed AI errors
//
// Every failure mode that the provider, the parser, or the quota layer can
// produce maps to one of these codes. Callers (routes, tests) can branch on
// `code` without parsing English error messages.
//
// HTTP semantics are deliberately bundled into the code so the route layer
// can convert with one switch statement.
// =============================================================================

export type AiErrorCode =
    | 'DISABLED' // AI feature is turned off in config
    | 'BAD_REQUEST' // The caller sent invalid input
    | 'UNAUTHORIZED' // Provider rejected our key
    | 'QUOTA_EXCEEDED' // User has used up their monthly token budget
    | 'RATE_LIMITED' // Provider rate-limited us (429)
    | 'TIMEOUT' // Provider didn't respond in time
    | 'PROVIDER_ERROR' // Provider returned 5xx
    | 'BAD_JSON' // Provider response wasn't valid JSON when one was required
    | 'CONTENT_FILTER' // Provider refused on safety grounds
    | 'UNKNOWN';

const HTTP_STATUS: Record<AiErrorCode, number> = {
    DISABLED: 503,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 502, // bubble up as 502 to the user — it's our problem, not theirs
    QUOTA_EXCEEDED: 429,
    RATE_LIMITED: 429,
    TIMEOUT: 504,
    PROVIDER_ERROR: 502,
    BAD_JSON: 502,
    CONTENT_FILTER: 422,
    UNKNOWN: 500,
};

export class AiError extends Error {
    readonly code: AiErrorCode;
    readonly status: number;
    readonly cause: unknown;

    constructor(code: AiErrorCode, message: string, cause?: unknown) {
        super(message);
        this.name = 'AiError';
        this.code = code;
        this.status = HTTP_STATUS[code];
        this.cause = cause;
    }

    toJSON(): { code: AiErrorCode; message: string } {
        return { code: this.code, message: this.message };
    }
}
