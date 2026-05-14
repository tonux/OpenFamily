// =============================================================================
// "Immediate" mode template — one email per notification.
// =============================================================================
import { escapeHtml, notificationPath, wrapEmail } from './shared';

export interface NotificationEmailInput {
    recipientName: string;
    notification: {
        type: string;
        title: string;
        message: string;
    };
    appBaseUrl: string;
}

const SUBJECT_PREFIX_BY_TYPE: Record<string, string> = {
    appointment_reminder_30min: '[OpenFamily] Rendez-vous dans 30 minutes',
    appointment_reminder_1hour: '[OpenFamily] Rendez-vous dans 1 heure',
    task_due_today: '[OpenFamily] Tâche à faire aujourd’hui',
    task_overdue: '[OpenFamily] Tâche en retard',
    contract_due_soon: '[OpenFamily] Échéance contrat',
    maintenance_due_soon: '[OpenFamily] Entretien à prévoir',
    warranty_expiring: '[OpenFamily] Garantie bientôt expirée',
};

export const renderNotificationEmail = (
    input: NotificationEmailInput,
): { subject: string; html: string; text: string } => {
    const { notification, recipientName, appBaseUrl } = input;
    const baseUrl = appBaseUrl.replace(/\/+$/, '');
    const ctaUrl = `${baseUrl}${notificationPath(notification.type)}`;
    const settingsUrl = `${baseUrl}/settings`;

    const subject =
        SUBJECT_PREFIX_BY_TYPE[notification.type] ?? `[OpenFamily] ${notification.title}`;

    const bodyHtml = `
      <h1 style="margin:16px 0 8px 0;font-size:20px;line-height:1.3;color:#18181b;">${escapeHtml(notification.title)}</h1>
      <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;">Bonjour ${escapeHtml(recipientName)},</p>
      <p style="margin:0 0 20px 0;font-size:16px;line-height:1.5;color:#18181b;">${escapeHtml(notification.message)}</p>
      <p style="margin:0;">
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;">Voir dans OpenFamily</a>
      </p>
    `;

    const html = wrapEmail({ title: notification.title, bodyHtml, settingsUrl });

    const text = [
        `Bonjour ${recipientName},`,
        '',
        notification.title,
        notification.message,
        '',
        `Voir dans OpenFamily : ${ctaUrl}`,
        '',
        '— OpenFamily',
        `Gérer mes préférences : ${settingsUrl}`,
    ].join('\n');

    return { subject, html, text };
};
