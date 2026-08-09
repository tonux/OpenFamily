import cron, { type ScheduledTask } from 'node-cron';
import { query } from '../db';
import { createNotificationIfNotExists } from './notifications';
import logger from './logger';
import { getEmailConfig } from '../email/config';
import { processDailyDigests, processImmediateEmails } from '../email/emailWorker';

// =============================================================================
// Notifications scheduler
//
// Two cron jobs cover all the deadline-driven notifications the app emits:
//
//  1. Every 15 minutes  → appointment reminders (30 min and 1 hour before).
//                         Need a tight cadence so the timing is reasonably
//                         accurate; reminder_30min/reminder_1hour flags on
//                         the appointments row are honored.
//  2. Daily at 08:00    → today's tasks, overdue tasks, contracts due in
//                         3 days, maintenance due in 7 days, warranties
//                         expiring in 30 days. One pulse per morning.
//
// Per-job dedup windows make re-running these idempotent. The cron loop
// fires server-time; we don't need per-user timezones for v1 — a notification
// arriving an hour off is fine for non-critical reminders.
// =============================================================================

let started = false;
const schedules: ScheduledTask[] = [];

const safeRun = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try {
        await fn();
    } catch (err) {
        // A scheduler error must NOT crash the server. Log loudly and move on.
        logger.error(`notifications.scheduler.${label}_failed`, {
            error: err instanceof Error ? err.message : String(err),
        });
    }
};

// ---------------------------------------------------------------------------
// Job 1: appointment reminders (every 15 min)
// ---------------------------------------------------------------------------

const runAppointmentReminders = async (): Promise<void> => {
    // Pull every appointment starting in [now+15min, now+90min]. The window
    // intentionally overshoots both reminder thresholds (30min, 60min) so a
    // 15-min cron stride catches both with margin. Per-row dedup prevents
    // double sends.
    const result = await query(
        `SELECT id, user_id, title, start_time, location,
                reminder_30min, reminder_1hour
         FROM appointments
         WHERE start_time > NOW()
           AND start_time <= NOW() + INTERVAL '90 minutes'
           AND (reminder_30min = true OR reminder_1hour = true)`,
    );

    for (const row of result.rows) {
        const startMs = new Date(row.start_time).getTime();
        const minutesUntil = Math.round((startMs - Date.now()) / 60_000);

        // Pick the closest threshold each appointment qualifies for. We
        // dedupe per (type, related_id), so 30min and 1h notifications for
        // the same appointment are independent rows.
        if (row.reminder_1hour && minutesUntil >= 50 && minutesUntil <= 70) {
            await createNotificationIfNotExists({
                userId: row.user_id,
                type: 'appointment_reminder_1hour',
                title: 'Rendez-vous dans 1 heure',
                message: row.location ? `${row.title} — ${row.location}` : row.title,
                relatedId: row.id,
                dedupWindowHours: 2,
            });
        }
        if (row.reminder_30min && minutesUntil >= 20 && minutesUntil <= 40) {
            await createNotificationIfNotExists({
                userId: row.user_id,
                type: 'appointment_reminder_30min',
                title: 'Rendez-vous dans 30 minutes',
                message: row.location ? `${row.title} — ${row.location}` : row.title,
                relatedId: row.id,
                dedupWindowHours: 1,
            });
        }
    }
};

// ---------------------------------------------------------------------------
// Job 2: morning pulse (daily at 08:00)
// ---------------------------------------------------------------------------

const runMorningPulse = async (): Promise<void> => {
    // (a) Today's tasks — one notification per pending task due today.
    const todayTasks = await query(
        `SELECT id, user_id, title FROM tasks
         WHERE is_completed = false
           AND due_date IS NOT NULL
           AND due_date::date = CURRENT_DATE`,
    );
    for (const row of todayTasks.rows) {
        await createNotificationIfNotExists({
            userId: row.user_id,
            type: 'task_due_today',
            title: 'Tâche à faire aujourd’hui',
            message: row.title,
            relatedId: row.id,
            dedupWindowHours: 23,
        });
    }

    // (b) Tasks overdue by more than 3 days — escalate.
    const overdueTasks = await query(
        `SELECT id, user_id, title, due_date FROM tasks
         WHERE is_completed = false
           AND due_date IS NOT NULL
           AND due_date::date <= CURRENT_DATE - 3`,
    );
    for (const row of overdueTasks.rows) {
        const days = Math.max(
            1,
            Math.round((Date.now() - new Date(row.due_date).getTime()) / (24 * 60 * 60 * 1000)),
        );
        await createNotificationIfNotExists({
            userId: row.user_id,
            type: 'task_overdue',
            title: 'Tâche en retard',
            message: `${row.title} (${days} jours)`,
            relatedId: row.id,
            dedupWindowHours: 48, // every other day at most
        });
    }

    // (c) Contracts due in the next 3 days — preempt manual payments.
    const dueContracts = await query(
        `SELECT id, user_id, name, amount, next_due_date FROM house_contracts
         WHERE is_active = true
           AND next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'`,
    );
    for (const row of dueContracts.rows) {
        const daysUntil = Math.max(
            0,
            Math.round(
                (new Date(row.next_due_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
            ),
        );
        const when =
            daysUntil === 0
                ? "aujourd'hui"
                : daysUntil === 1
                  ? 'demain'
                  : `dans ${daysUntil} jours`;
        await createNotificationIfNotExists({
            userId: row.user_id,
            type: 'contract_due_soon',
            title: 'Échéance contrat',
            message: `${row.name} — ${Number(row.amount).toFixed(2)} € ${when}`,
            relatedId: row.id,
            dedupWindowHours: 23,
        });
    }

    // (d) Maintenance planned in the next 7 days.
    const dueMaintenance = await query(
        `SELECT m.id, m.user_id, m.title, m.planned_date, e.name AS equipment_name
         FROM house_maintenance m
         JOIN house_equipments e ON m.equipment_id = e.id
         WHERE m.planned_date IS NOT NULL
           AND m.performed_date IS NULL
           AND m.planned_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`,
    );
    for (const row of dueMaintenance.rows) {
        const daysUntil = Math.max(
            0,
            Math.round((new Date(row.planned_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        );
        const when =
            daysUntil === 0
                ? "aujourd'hui"
                : daysUntil === 1
                  ? 'demain'
                  : `dans ${daysUntil} jours`;
        await createNotificationIfNotExists({
            userId: row.user_id,
            type: 'maintenance_due_soon',
            title: 'Entretien à prévoir',
            message: `${row.title} — ${row.equipment_name} — ${when}`,
            relatedId: row.id,
            dedupWindowHours: 23,
        });
    }

    // (e bis) Garden care planned for today/tomorrow (watering, mowing, …).
    const dueGardenCare = await query(
        `SELECT c.id, c.user_id, c.title, c.care_type, c.planned_date,
                z.name AS zone_name, p.name AS plant_name
         FROM garden_care c
         LEFT JOIN garden_zones z ON c.zone_id = z.id
         LEFT JOIN garden_plants p ON c.plant_id = p.id
         WHERE c.planned_date IS NOT NULL
           AND c.performed_date IS NULL
           AND c.planned_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day'`,
    );
    for (const row of dueGardenCare.rows) {
        const daysUntil = Math.max(
            0,
            Math.round((new Date(row.planned_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        );
        const when = daysUntil === 0 ? "aujourd'hui" : 'demain';
        const target = row.plant_name ?? row.zone_name;
        await createNotificationIfNotExists({
            userId: row.user_id,
            type: 'garden_care_due',
            title: 'Entretien jardin à faire',
            message: target ? `${row.title} — ${target} — ${when}` : `${row.title} — ${when}`,
            relatedId: row.id,
            dedupWindowHours: 23,
        });
    }

    // (e ter) School calendar: events whose own lead time lands on today.
    // Each row carries reminder_days_before (default 1), so the parent gets the
    // heads-up "the day before" by default, and earlier for the events that
    // need preparation (rentrée, semaine de relâche…).
    const dueSchoolEvents = await query(
        `SELECT e.id, e.user_id, e.title, e.event_type, e.start_date, e.start_time,
                e.location, e.reminder_days_before, s.name AS student_name
         FROM school_events e
         LEFT JOIN school_students s ON e.student_id = s.id
         WHERE e.reminder_enabled = true
           AND e.start_date - e.reminder_days_before = CURRENT_DATE`,
    );
    for (const row of dueSchoolEvents.rows) {
        const lead = Number(row.reminder_days_before);
        const when = lead === 0 ? "aujourd'hui" : lead === 1 ? 'demain' : `dans ${lead} jours`;
        const startTime = typeof row.start_time === 'string' ? row.start_time.slice(0, 5) : null;
        const details = [row.student_name, row.location, startTime].filter(Boolean).join(' — ');
        await createNotificationIfNotExists({
            userId: row.user_id,
            type: 'school_event_reminder',
            title: `École : ${row.title} ${when}`,
            message: details ? `${row.event_type} — ${details}` : row.event_type,
            relatedId: row.id,
            dedupWindowHours: 23,
        });
    }

    // (e quater) At-home study sessions planned for today or tomorrow.
    const dueStudySessions = await query(
        `SELECT ss.id, ss.user_id, ss.subject, ss.title, ss.scheduled_date, ss.start_time,
                ss.duration_minutes, s.name AS student_name
         FROM school_study_sessions ss
         JOIN school_students s ON ss.student_id = s.id
         WHERE ss.reminder_enabled = true
           AND ss.status = 'Planifiée'
           AND ss.scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day'`,
    );
    for (const row of dueStudySessions.rows) {
        const daysUntil = Math.max(
            0,
            Math.round(
                (new Date(row.scheduled_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
            ),
        );
        const when = daysUntil === 0 ? "aujourd'hui" : 'demain';
        await createNotificationIfNotExists({
            userId: row.user_id,
            type: 'school_study_reminder',
            title: `Étude ${when} : ${row.subject}`,
            message: `${row.title} — ${row.student_name} — ${row.duration_minutes} min`,
            relatedId: row.id,
            dedupWindowHours: 23,
        });
    }

    // (e quinquies) Back-to-school shopping still open with the rentrée in
    // sight. One nudge per student per week — the parent can't act daily, and
    // the checklist itself is the detailed view.
    const pendingSupplies = await query(
        `SELECT s.id, s.user_id, s.name,
                COUNT(*) FILTER (WHERE sup.is_purchased = false) AS remaining,
                MIN(e.start_date) AS rentree_date
         FROM school_students s
         JOIN school_supplies sup ON sup.student_id = s.id
         JOIN school_events e ON e.student_id = s.id
           AND e.event_type = 'Rentrée'
           AND e.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '21 days'
         GROUP BY s.id, s.user_id, s.name
         HAVING COUNT(*) FILTER (WHERE sup.is_purchased = false) > 0`,
    );
    for (const row of pendingSupplies.rows) {
        const daysUntil = Math.max(
            0,
            Math.round((new Date(row.rentree_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        );
        await createNotificationIfNotExists({
            userId: row.user_id,
            type: 'school_supplies_pending',
            title: 'Fournitures scolaires à acheter',
            message: `${row.name} — ${row.remaining} article(s) restant(s), rentrée dans ${daysUntil} jours`,
            relatedId: row.id,
            dedupWindowHours: 24 * 7,
        });
    }

    // (e) Warranties expiring in the next 30 days. Notify once a week per
    // equipment (long dedup window) since the user can't act every day.
    const expiringWarranties = await query(
        `SELECT id, user_id, name, warranty_until FROM house_equipments
         WHERE warranty_until IS NOT NULL
           AND warranty_until BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`,
    );
    for (const row of expiringWarranties.rows) {
        const daysUntil = Math.max(
            0,
            Math.round(
                (new Date(row.warranty_until).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
            ),
        );
        await createNotificationIfNotExists({
            userId: row.user_id,
            type: 'warranty_expiring',
            title: 'Garantie bientôt expirée',
            message: `${row.name} — expire dans ${daysUntil} jours`,
            relatedId: row.id,
            dedupWindowHours: 24 * 7,
        });
    }
};

// ---------------------------------------------------------------------------
// Boot / shutdown
// ---------------------------------------------------------------------------

export const startNotificationsScheduler = (): void => {
    if (started) {
        logger.warn('notifications.scheduler_already_started');
        return;
    }
    if (process.env.NOTIFICATIONS_DISABLED === 'true') {
        logger.info('notifications.scheduler_disabled_by_env');
        started = true;
        return;
    }

    // node-cron syntax: "minute hour day month weekday"
    const appointmentJob = cron.schedule('*/15 * * * *', () => {
        void safeRun('appointments', runAppointmentReminders);
    });
    const morningJob = cron.schedule('0 8 * * *', () => {
        void safeRun('morning_pulse', runMorningPulse);
    });

    schedules.push(appointmentJob, morningJob);

    // Email workers — only register when email is enabled. We keep them in the
    // same scheduler module so a single stop() call shuts everything down.
    const startedJobs = ['appointments_every_15m', 'morning_pulse_daily_8am'];
    const emailCfg = getEmailConfig();
    if (emailCfg.enabled) {
        // Immediate mode: drain pending notifications every 5 min. Tight enough
        // to feel near-realtime, loose enough to coalesce a burst into one batch.
        const immediateJob = cron.schedule('*/5 * * * *', () => {
            void safeRun('email_immediate', async () => {
                await processImmediateEmails();
            });
        });

        // Daily digests: send right after the morning pulse finishes inserting
        // the day's notifications. Same hour as the pulse, +5 min so the rows
        // exist by the time we scan.
        const digestJob = cron.schedule(`5 ${emailCfg.digestHour} * * *`, () => {
            void safeRun('email_digest', async () => {
                await processDailyDigests();
            });
        });

        schedules.push(immediateJob, digestJob);
        startedJobs.push(
            'email_immediate_every_5m',
            `email_digest_daily_${emailCfg.digestHour}h05`,
        );
    } else {
        logger.info('notifications.email_workers_disabled');
    }

    started = true;
    logger.info('notifications.scheduler_started', { jobs: startedJobs });
};

export const stopNotificationsScheduler = (): void => {
    for (const task of schedules) {
        task.stop();
    }
    schedules.length = 0;
    started = false;
};

// Exposed so an admin/dev endpoint can trigger the morning pulse on demand.
export const _runMorningPulseNow = runMorningPulse;
export const _runAppointmentRemindersNow = runAppointmentReminders;
export const _runEmailImmediateNow = processImmediateEmails;
export const _runEmailDigestNow = processDailyDigests;
