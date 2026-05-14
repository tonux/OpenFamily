// =============================================================================
// Email errors
//
// Typed errors so the worker can decide whether to retry, abandon, or surface
// to the user. Mirrors the shape of src/ai/errors.ts for consistency.
// =============================================================================

export type EmailErrorCode =
    | 'DISABLED' // EMAIL_ENABLED=false — caller asked us to send anyway
    | 'TRANSPORT' // unknown nodemailer/SMTP failure (network, etc.) — retry
    | 'SMTP_AUTH' // 535/auth failure — DON'T retry, fix the key
    | 'RECIPIENT_INVALID' // 5xx on RCPT TO — DON'T retry, bad recipient
    | 'TEMPLATE'; // template assembly failed — bug, DON'T retry

export class EmailError extends Error {
    public readonly code: EmailErrorCode;
    public readonly retryable: boolean;

    constructor(code: EmailErrorCode, message: string, retryable: boolean) {
        super(message);
        this.name = 'EmailError';
        this.code = code;
        this.retryable = retryable;
    }
}

// Crude classifier — nodemailer surfaces `responseCode` for SMTP errors and
// `code` for transport-level failures. Anything outside the well-known buckets
// is treated as TRANSPORT (retryable) since the alternative is dropping mail.
export const classifySmtpError = (err: unknown): EmailError => {
    const anyErr = err as { code?: string; responseCode?: number; message?: string };
    const message = anyErr.message ?? String(err);
    const responseCode = anyErr.responseCode;

    // SMTP auth failures: 535 most common, also 530.
    if (responseCode === 535 || responseCode === 530) {
        return new EmailError('SMTP_AUTH', `SMTP auth rejected: ${message}`, false);
    }
    // Permanent recipient failures: 550, 553, etc. (5xx range, recipient-related).
    if (responseCode && responseCode >= 550 && responseCode < 560) {
        return new EmailError('RECIPIENT_INVALID', `Recipient rejected: ${message}`, false);
    }
    // Everything else — connection refused, timeouts, transient 4xx — retry.
    return new EmailError('TRANSPORT', message, true);
};
