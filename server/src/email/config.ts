// =============================================================================
// Email configuration
//
// SMTP-only transport (Resend by default). Modelled on src/ai/config.ts: all
// values come from env, cached after the first read, and we crash at boot if
// EMAIL_ENABLED=true without the credentials needed to actually send.
//
// Setting EMAIL_ENABLED=false is the supported way to opt out (self-hosters
// without a Resend account, CI, etc.) — the worker becomes a no-op.
// =============================================================================
import logger from '../lib/logger';

export interface EmailConfig {
    enabled: boolean;
    smtp: {
        host: string;
        port: number;
        secure: boolean;
        user: string;
        password: string;
    };
    from: string;
    replyTo: string | null;
    appBaseUrl: string;
    digestHour: number; // 0-23, server-local timezone
    testEndpointEnabled: boolean;
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
    return Number.isFinite(n) ? n : fallback;
};

let cached: EmailConfig | null = null;

export const getEmailConfig = (): EmailConfig => {
    if (cached) return cached;

    const enabled = parseBoolEnv(process.env.EMAIL_ENABLED, true);
    const host = process.env.RESEND_SMTP_HOST?.trim() || 'smtp.resend.com';
    const port = parseIntEnv(process.env.RESEND_SMTP_PORT, 465);
    const user = process.env.RESEND_SMTP_USER?.trim() || 'resend';
    const password = process.env.RESEND_SMTP_PASSWORD?.trim() ?? '';
    const from = process.env.EMAIL_FROM?.trim() ?? '';

    if (enabled) {
        if (!password) {
            throw new Error(
                'EMAIL_ENABLED=true but RESEND_SMTP_PASSWORD is missing. ' +
                    'Set the Resend API key (starts with "re_") or set EMAIL_ENABLED=false.',
            );
        }
        if (!from) {
            throw new Error(
                'EMAIL_ENABLED=true but EMAIL_FROM is missing. ' +
                    'Set EMAIL_FROM to a verified Resend sender (e.g. "OpenFamily <notifs@yourdomain.com>").',
            );
        }
        // Resend keys are prefixed with "re_". Wrong key = silent SMTP auth
        // failure later, so flag obvious mismatches early.
        if (!password.startsWith('re_')) {
            logger.warn('email.password_unexpected_prefix', {
                hint: 'Resend API keys usually start with "re_". Double-check the value.',
            });
        }
    }

    const digestHourRaw = parseIntEnv(process.env.EMAIL_DIGEST_HOUR, 8);
    const digestHour = digestHourRaw >= 0 && digestHourRaw <= 23 ? digestHourRaw : 8;

    cached = {
        enabled,
        smtp: {
            host,
            port,
            // Port 465 → implicit TLS. Other ports (587, 2525) use STARTTLS.
            secure: port === 465,
            user,
            password,
        },
        from,
        replyTo: process.env.EMAIL_REPLY_TO?.trim() || null,
        // Used to build CTA links in emails. Falls back to first CORS origin.
        appBaseUrl:
            process.env.APP_BASE_URL?.trim() ||
            process.env.CORS_ORIGINS?.split(',')[0]?.trim() ||
            'http://localhost:5173',
        digestHour,
        testEndpointEnabled:
            parseBoolEnv(process.env.EMAIL_TEST_ENABLED, false) ||
            process.env.NODE_ENV !== 'production',
    };

    logger.info('email.config_loaded', {
        enabled: cached.enabled,
        smtpHost: cached.smtp.host,
        smtpPort: cached.smtp.port,
        from: cached.from,
        digestHour: cached.digestHour,
        appBaseUrl: cached.appBaseUrl,
        // Never log the password.
    });

    return cached;
};

export const resetEmailConfigCache = (): void => {
    cached = null;
};
