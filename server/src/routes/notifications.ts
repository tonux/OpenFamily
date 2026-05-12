import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import logger from '../lib/logger';

// =============================================================================
// /api/notifications
//
// In-app notifications surface. The cron scheduler writes here; the bell-icon
// in the client header reads here. No write endpoints from the user — they
// can only mark as read or delete.
// =============================================================================

const router = Router();
router.use(authMiddleware);

const mapNotification = (row: any) => ({
    id: row.id as string,
    title: row.title as string,
    message: row.message as string,
    type: row.type as string,
    is_read: row.is_read as boolean,
    related_id: row.related_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

// List the most recent N notifications. Default limit 50: enough for the
// dropdown + a few days of scrollback without paginating.
router.get('/', async (req: AuthRequest, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query.limit ?? '50'), 10);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit <= 200 ? rawLimit : 50;
        const result = await query(
            `SELECT * FROM notifications
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [req.userId, limit],
        );
        res.json({ success: true, data: result.rows.map(mapNotification) });
    } catch (error) {
        logger.error('notifications.list_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Lightweight counter: polled every 60s by the bell badge, must stay cheap.
// The dedicated index makes this O(unread).
router.get('/unread-count', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            'SELECT COUNT(*) AS c FROM notifications WHERE user_id = $1 AND is_read = false',
            [req.userId],
        );
        res.json({ success: true, data: { count: Number(result.rows[0].c) } });
    } catch (error) {
        logger.error('notifications.unread_count_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.patch('/:id/read', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            `UPDATE notifications SET is_read = true
             WHERE id = $1 AND user_id = $2
             RETURNING id`,
            [req.params.id, req.userId],
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Notification not found' });
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('notifications.mark_read_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/mark-all-read', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
            [req.userId],
        );
        res.json({ success: true, data: { updated: result.rowCount ?? 0 } });
    } catch (error) {
        logger.error('notifications.mark_all_read_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.delete('/:id', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Notification not found' });
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('notifications.delete_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
