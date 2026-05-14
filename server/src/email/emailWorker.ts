// =============================================================================
// Email worker
//
// Two entry points exposed for the cron scheduler in lib/notificationsScheduler:
//
//   processImmediateEmails()  — every 5 minutes
//     Sends one email per pending notification belonging to a user with
//     `email_digest_mode = 'immediate'`. Marks `email_sent_at` on success or
//     bumps `email_attempts` on failure (capped at 5 by the partial index).
//
//   processDailyDigests()     — once a day at the configured digest hour
//     For each user with `email_digest_mode = 'daily'`, gathers their unsent
//     notifications from the last 24h into one email and marks them all sent.
//
// Both paths are conservative: per-user errors are logged and swallowed so a
// single bad recipient never blocks the rest of the queue.
// =============================================================================
import { query } from '../db';
import logger from '../lib/logger';
import { getEmailConfig } from './config';
import { sendDigestEmail, sendNotificationEmail, type EmailRecipient } from './EmailService';
import type { DigestNotification } from './templates/digestEmail';
import { EmailError } from './errors';

const MAX_ATTEMPTS = 5;
const IMMEDIATE_BATCH_SIZE = 50;

interface PendingRow {
    id: string;
    type: string;
    title: string;
    message: string;
    user_id: string;
    user_email: string;
    user_name: string;
}

const markSent = async (notificationId: string): Promise<void> => {
    await query(
        `UPDATE notifications
         SET email_sent_at = NOW(), email_last_error = NULL
         WHERE id = $1`,
        [notificationId],
    );
};

const markFailed = async (notificationId: string, error: EmailError): Promise<void> => {
    // We bump attempts even for non-retryable errors so the row falls out of
    // the pending index quickly (5 attempts = giving up either way).
    const increment = error.retryable ? 1 : MAX_ATTEMPTS;
    await query(
        `UPDATE notifications
         SET email_attempts = LEAST($2, email_attempts + $3),
             email_last_error = $4
         WHERE id = $1`,
        [notificationId, MAX_ATTEMPTS, increment, `${error.code}: ${error.message}`.slice(0, 1000)],
    );
};

/**
 * Send one email per pending notification for users in "immediate" mode.
 * Returns counts for observability.
 */
export const processImmediateEmails = async (): Promise<{
    sent: number;
    failed: number;
    skipped: number;
}> => {
    const cfg = getEmailConfig();
    if (!cfg.enabled) {
        return { sent: 0, failed: 0, skipped: 0 };
    }

    const result = await query(
        `SELECT n.id, n.type, n.title, n.message,
                u.id AS user_id, u.email AS user_email, u.name AS user_name
         FROM notifications n
         JOIN users u ON u.id = n.user_id
         WHERE n.email_sent_at IS NULL
           AND n.email_attempts < $1
           AND u.email_notifications_enabled = true
           AND u.email_digest_mode = 'immediate'
         ORDER BY n.created_at ASC
         LIMIT $2`,
        [MAX_ATTEMPTS, IMMEDIATE_BATCH_SIZE],
    );

    let sent = 0;
    let failed = 0;
    for (const row of result.rows as PendingRow[]) {
        try {
            await sendNotificationEmail(
                { email: row.user_email, name: row.user_name },
                { type: row.type, title: row.title, message: row.message },
            );
            await markSent(row.id);
            sent++;
        } catch (err) {
            const emailErr =
                err instanceof EmailError
                    ? err
                    : new EmailError(
                          'TRANSPORT',
                          err instanceof Error ? err.message : String(err),
                          true,
                      );
            await markFailed(row.id, emailErr);
            failed++;
            logger.warn('email.notification_send_failed', {
                notificationId: row.id,
                userId: row.user_id,
                code: emailErr.code,
                retryable: emailErr.retryable,
                error: emailErr.message,
            });
        }
    }

    if (sent > 0 || failed > 0) {
        logger.info('email.immediate_batch', { sent, failed, scanned: result.rows.length });
    }
    return { sent, failed, skipped: 0 };
};

/**
 * Send one digest email per "daily" user covering everything created in the
 * last 24h that hasn't already been emailed. Marks every included notification
 * as sent in a single UPDATE on success.
 */
export const processDailyDigests = async (): Promise<{ users: number; emails: number }> => {
    const cfg = getEmailConfig();
    if (!cfg.enabled) {
        return { users: 0, emails: 0 };
    }

    // First: find users in daily mode who actually have pending notifications.
    // Doing this in two queries keeps the per-user query simple and indexed.
    const usersResult = await query(
        `SELECT DISTINCT u.id, u.email, u.name
         FROM users u
         JOIN notifications n ON n.user_id = u.id
         WHERE u.email_notifications_enabled = true
           AND u.email_digest_mode = 'daily'
           AND n.email_sent_at IS NULL
           AND n.email_attempts < $1
           AND n.created_at > NOW() - INTERVAL '24 hours'`,
        [MAX_ATTEMPTS],
    );

    let emails = 0;
    for (const userRow of usersResult.rows as Array<{ id: string; email: string; name: string }>) {
        const notifsResult = await query(
            `SELECT id, type, title, message, created_at
             FROM notifications
             WHERE user_id = $1
               AND email_sent_at IS NULL
               AND email_attempts < $2
               AND created_at > NOW() - INTERVAL '24 hours'
             ORDER BY created_at ASC`,
            [userRow.id, MAX_ATTEMPTS],
        );
        const notifs = notifsResult.rows as DigestNotification[];
        if (notifs.length === 0) continue;

        const recipient: EmailRecipient = { email: userRow.email, name: userRow.name };
        try {
            await sendDigestEmail(recipient, notifs);
            const ids = notifs.map((n) => n.id);
            await query(
                `UPDATE notifications
                 SET email_sent_at = NOW(), email_last_error = NULL
                 WHERE id = ANY($1::uuid[])`,
                [ids],
            );
            emails++;
        } catch (err) {
            const emailErr =
                err instanceof EmailError
                    ? err
                    : new EmailError(
                          'TRANSPORT',
                          err instanceof Error ? err.message : String(err),
                          true,
                      );
            // Bump every included notification so we retry next run (or give
            // up after 5 attempts). We don't want the digest job to repeatedly
            // fail-and-resend without bounded backoff.
            const ids = notifs.map((n) => n.id);
            const increment = emailErr.retryable ? 1 : MAX_ATTEMPTS;
            await query(
                `UPDATE notifications
                 SET email_attempts = LEAST($2, email_attempts + $3),
                     email_last_error = $4
                 WHERE id = ANY($1::uuid[])`,
                [
                    ids,
                    MAX_ATTEMPTS,
                    increment,
                    `${emailErr.code}: ${emailErr.message}`.slice(0, 1000),
                ],
            );
            logger.warn('email.digest_send_failed', {
                userId: userRow.id,
                count: notifs.length,
                code: emailErr.code,
                error: emailErr.message,
            });
        }
    }

    if (emails > 0) {
        logger.info('email.digest_batch', { users: usersResult.rows.length, emails });
    }
    return { users: usersResult.rows.length, emails };
};
