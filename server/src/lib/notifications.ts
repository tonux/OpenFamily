import { query } from '../db';
import logger from './logger';

// =============================================================================
// Notifications helper
//
// Inserts dedup'd in-app notifications. The cron scheduler runs the same
// jobs many times a day (every 15 min for appointment reminders, daily for
// the rest), so without dedup the user would see duplicate rows for each
// run. Strategy: before INSERT, check whether a row with the same
// (user_id, type, related_id) was created within the dedup window. If yes,
// skip. Tunable per call so daily-cadence jobs use a 24h window and the
// short-cadence appointment job uses a 90-min window.
// =============================================================================

export type NotificationType =
    // Existing module-driven types may exist; the cron scheduler currently
    // emits the ones below.
    | 'appointment_reminder_30min'
    | 'appointment_reminder_1hour'
    | 'task_due_today'
    | 'task_overdue'
    | 'contract_due_soon'
    | 'maintenance_due_soon'
    | 'warranty_expiring'
    | string;

export interface CreateNotificationInput {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    relatedId?: string | null;
    /** Hours within which a duplicate (same user + type + relatedId) is suppressed. */
    dedupWindowHours?: number;
}

/**
 * Insert a notification iff none with the same (user_id, type, related_id)
 * exists within the dedup window. Returns the new row, or null if deduped.
 */
export const createNotificationIfNotExists = async (
    input: CreateNotificationInput,
): Promise<{ id: string } | null> => {
    const dedupHours = input.dedupWindowHours ?? 24;
    if (input.relatedId) {
        const existing = await query(
            `SELECT id FROM notifications
             WHERE user_id = $1 AND type = $2 AND related_id = $3
               AND created_at > NOW() - ($4 || ' hours')::interval
             LIMIT 1`,
            [input.userId, input.type, input.relatedId, String(dedupHours)],
        );
        if (existing.rows.length > 0) return null;
    }

    const result = await query(
        `INSERT INTO notifications (user_id, title, message, type, related_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [input.userId, input.title, input.message, input.type, input.relatedId ?? null],
    );

    logger.debug('notifications.created', {
        type: input.type,
        relatedId: input.relatedId,
        userId: input.userId,
    });
    return { id: result.rows[0].id as string };
};
