import { Router } from 'express';
import { getClient, query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { toNullIfEmpty } from '../lib/normalize';
import logger from '../lib/logger';

const router = Router();
router.use(authMiddleware);

// Frequencies that trigger auto-creation of the next occurrence when a task
// is completed. 'Une fois' is intentionally absent — it's the no-recur case.
// Mapped to an interval expression Postgres can add to a date directly.
const RECURRENCE_INTERVAL: Record<string, string> = {
    Quotidien: '1 day',
    Hebdomadaire: '7 days',
    Mensuel: '1 month',
    Annuel: '1 year',
};

const ensureMembersBelongToUser = async (memberIds: string[], userId: string) => {
    for (const memberId of memberIds) {
        const member = await query('SELECT id FROM family_members WHERE id = $1 AND user_id = $2', [
            memberId,
            userId,
        ]);
        if (member.rows.length === 0) {
            throw new Error('INVALID_MEMBER');
        }
    }
};

const enrichTasksWithMembers = async (tasks: any[], userId: string) => {
    if (tasks.length === 0) return tasks;
    const membersResult = await query(
        'SELECT id, name, color FROM family_members WHERE user_id = $1',
        [userId],
    );
    const membersById = new Map(membersResult.rows.map((m: any) => [m.id, m]));
    return tasks.map((task) => {
        const assignedTo: string[] = Array.isArray(task.assigned_to) ? task.assigned_to : [];
        return {
            ...task,
            assigned_to: assignedTo,
            assigned_to_members: assignedTo.map((id) => membersById.get(id)).filter(Boolean),
        };
    });
};

// Get all tasks
router.get('/', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            'SELECT * FROM tasks WHERE user_id = $1 ORDER BY due_date ASC NULLS LAST, created_at DESC',
            [req.userId],
        );
        const tasks = await enrichTasksWithMembers(result.rows, req.userId!);
        res.json({ success: true, data: tasks });
    } catch (error) {
        logger.error('tasks.get_tasks_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Create task
router.post('/', async (req: AuthRequest, res) => {
    try {
        const { title, description, due_date, frequency, priority, assigned_to } = req.body;

        const cleanedTitle = typeof title === 'string' ? title.trim() : '';
        if (!cleanedTitle) {
            return res.status(400).json({ success: false, error: 'Title is required' });
        }

        const assignedTo: string[] = Array.isArray(assigned_to)
            ? assigned_to.filter((id: any) => typeof id === 'string' && id.trim())
            : [];
        await ensureMembersBelongToUser(assignedTo, req.userId!);

        const result = await query(
            `INSERT INTO tasks (user_id, title, description, due_date, frequency, priority, assigned_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING *`,
            [
                req.userId,
                cleanedTitle,
                toNullIfEmpty(description),
                toNullIfEmpty(due_date),
                toNullIfEmpty(frequency),
                toNullIfEmpty(priority),
                JSON.stringify(assignedTo),
            ],
        );

        const [enriched] = await enrichTasksWithMembers([result.rows[0]], req.userId!);
        res.json({ success: true, data: enriched });
    } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_MEMBER') {
            return res.status(400).json({ success: false, error: 'Assigned member not found' });
        }

        logger.error('tasks.create_task_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Update task.
//
// Wrapped in a transaction so the "auto-recur on completion" side-effect is
// atomic with the update itself. Mirrors the same pattern used by
// house_maintenance: when `is_completed` transitions from false → true AND
// the task has a recurring frequency, INSERT the next occurrence (with
// is_completed=false, completed_at=null, due_date pushed by the interval).
router.put('/:id', async (req: AuthRequest, res) => {
    const { id } = req.params;
    const { title, description, is_completed, due_date, frequency, priority, assigned_to } =
        req.body;

    const updates: string[] = [];
    const values: any[] = [];

    const pushUpdate = (field: string, value: any) => {
        values.push(value);
        updates.push(`${field} = $${values.length}`);
    };

    if (title !== undefined) {
        const cleanedTitle = typeof title === 'string' ? title.trim() : '';
        if (!cleanedTitle) {
            return res.status(400).json({ success: false, error: 'Title cannot be empty' });
        }
        pushUpdate('title', cleanedTitle);
    }
    if (description !== undefined) pushUpdate('description', toNullIfEmpty(description));
    if (due_date !== undefined) pushUpdate('due_date', toNullIfEmpty(due_date));
    if (frequency !== undefined) pushUpdate('frequency', toNullIfEmpty(frequency));
    if (priority !== undefined) pushUpdate('priority', toNullIfEmpty(priority));

    let assignedToValidate: string[] | null = null;
    if (assigned_to !== undefined) {
        assignedToValidate = Array.isArray(assigned_to)
            ? assigned_to.filter((mid: any) => typeof mid === 'string' && mid.trim())
            : [];
        values.push(JSON.stringify(assignedToValidate));
        updates.push(`assigned_to = $${values.length}::jsonb`);
    }

    if (is_completed !== undefined) {
        const isCompleted = Boolean(is_completed);
        pushUpdate('is_completed', isCompleted);
        updates.push(`completed_at = ${isCompleted ? 'NOW()' : 'NULL'}`);
    }

    if (updates.length === 0) {
        return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    const client = await getClient();
    try {
        // Validate assigned members BEFORE the transaction so a 400 doesn't
        // leave a dangling BEGIN.
        if (assignedToValidate) {
            await ensureMembersBelongToUser(assignedToValidate, req.userId!);
        }

        await client.query('BEGIN');

        // Lock the row so two concurrent PUTs can't both observe
        // is_completed=false and double-create the next occurrence.
        const before = await client.query(
            'SELECT * FROM tasks WHERE id = $1 AND user_id = $2 FOR UPDATE',
            [id, req.userId],
        );
        if (before.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Task not found' });
        }
        const previous = before.rows[0];

        const after = await client.query(
            `UPDATE tasks
                SET ${updates.join(', ')}
              WHERE id = $${values.length + 1} AND user_id = $${values.length + 2}
              RETURNING *`,
            [...values, id, req.userId],
        );
        const updated = after.rows[0];

        // Recurrence trigger: ONLY fires on false→true transition AND when
        // the resulting frequency maps to a known interval. Marking an
        // already-completed task again is a no-op for the next occurrence.
        let nextOccurrence: any = null;
        const justCompleted = previous.is_completed === false && updated.is_completed === true;
        const interval = RECURRENCE_INTERVAL[updated.frequency as string];
        if (justCompleted && interval) {
            // Anchor the next due_date on the resulting due_date when the
            // task had one — keeps the cadence stable. Otherwise anchor on
            // today so we don't lose track of the new instance.
            const anchor = updated.due_date
                ? `($1::date + interval '${interval}')::timestamp`
                : `(CURRENT_DATE + interval '${interval}')::timestamp`;
            const params = updated.due_date
                ? [
                      updated.due_date,
                      req.userId,
                      updated.title,
                      updated.description,
                      updated.frequency,
                      updated.priority,
                      JSON.stringify(updated.assigned_to ?? []),
                  ]
                : [
                      req.userId,
                      updated.title,
                      updated.description,
                      updated.frequency,
                      updated.priority,
                      JSON.stringify(updated.assigned_to ?? []),
                  ];
            const userIdx = updated.due_date ? 2 : 1;
            const titleIdx = updated.due_date ? 3 : 2;
            const descIdx = updated.due_date ? 4 : 3;
            const freqIdx = updated.due_date ? 5 : 4;
            const prioIdx = updated.due_date ? 6 : 5;
            const assignIdx = updated.due_date ? 7 : 6;
            const insertNext = await client.query(
                `INSERT INTO tasks
                    (user_id, title, description, due_date, frequency, priority, assigned_to)
                 VALUES ($${userIdx}, $${titleIdx}, $${descIdx}, ${anchor},
                         $${freqIdx}, $${prioIdx}, $${assignIdx}::jsonb)
                 RETURNING *`,
                params,
            );
            nextOccurrence = insertNext.rows[0];
        }

        await client.query('COMMIT');

        const enriched = await enrichTasksWithMembers([updated], req.userId!);
        const enrichedNext = nextOccurrence
            ? await enrichTasksWithMembers([nextOccurrence], req.userId!)
            : null;

        res.json({
            success: true,
            data: {
                ...enriched[0],
                next_occurrence: enrichedNext ? enrichedNext[0] : null,
            },
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (error instanceof Error && error.message === 'INVALID_MEMBER') {
            return res.status(400).json({ success: false, error: 'Assigned member not found' });
        }
        logger.error('tasks.update_task_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Delete task
router.delete('/:id', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.userId],
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }

        res.json({ success: true, message: 'Task deleted' });
    } catch (error) {
        logger.error('tasks.delete_task_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Today + overdue split, used by the dashboard widget. Caps at 10 each so a
// huge backlog doesn't bloat the home page response. `upcoming_count` lets
// the widget hint "+12 dans les 7 jours" without sending the full list.
router.get('/today', async (req: AuthRequest, res) => {
    try {
        const todayRows = await query(
            `SELECT * FROM tasks
             WHERE user_id = $1
               AND is_completed = false
               AND due_date IS NOT NULL
               AND due_date::date = CURRENT_DATE
             ORDER BY priority NULLS LAST, created_at ASC
             LIMIT 10`,
            [req.userId],
        );
        const overdueRows = await query(
            `SELECT * FROM tasks
             WHERE user_id = $1
               AND is_completed = false
               AND due_date IS NOT NULL
               AND due_date::date < CURRENT_DATE
             ORDER BY due_date ASC
             LIMIT 10`,
            [req.userId],
        );
        const upcoming = await query(
            `SELECT COUNT(*) AS c FROM tasks
             WHERE user_id = $1
               AND is_completed = false
               AND due_date IS NOT NULL
               AND due_date::date BETWEEN CURRENT_DATE + 1 AND CURRENT_DATE + 7`,
            [req.userId],
        );

        const today = await enrichTasksWithMembers(todayRows.rows, req.userId!);
        const overdue = await enrichTasksWithMembers(overdueRows.rows, req.userId!);
        res.json({
            success: true,
            data: {
                today,
                overdue,
                upcoming_count: Number(upcoming.rows[0].c),
            },
        });
    } catch (error) {
        logger.error('tasks.get_today_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Get task statistics
router.get('/statistics', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE is_completed = true) as completed,
         COUNT(*) FILTER (WHERE is_completed = false) as pending,
         COUNT(*) FILTER (WHERE priority = 'Haute') as high_priority,
         COUNT(*) FILTER (WHERE priority = 'Moyenne') as medium_priority,
         COUNT(*) FILTER (WHERE priority = 'Basse') as low_priority
       FROM tasks WHERE user_id = $1`,
            [req.userId],
        );

        const stats = result.rows[0];
        const total = parseInt(stats.total, 10) || 0;
        const completed = parseInt(stats.completed, 10) || 0;
        const completionRate = total > 0 ? (completed / total) * 100 : 0;

        res.json({
            success: true,
            data: {
                total,
                completed,
                pending: parseInt(stats.pending, 10) || 0,
                completionRate: Math.round(completionRate),
                byPriority: {
                    Haute: parseInt(stats.high_priority, 10) || 0,
                    Moyenne: parseInt(stats.medium_priority, 10) || 0,
                    Basse: parseInt(stats.low_priority, 10) || 0,
                },
            },
        });
    } catch (error) {
        logger.error('tasks.get_task_statistics_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
