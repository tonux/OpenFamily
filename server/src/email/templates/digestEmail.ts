// =============================================================================
// "Daily" mode template — one email per user, grouped by category.
// =============================================================================
import { escapeHtml, notificationPath, wrapEmail } from './shared';

export interface DigestNotification {
    id: string;
    type: string;
    title: string;
    message: string;
    created_at: Date | string;
}

export interface DigestEmailInput {
    recipientName: string;
    notifications: DigestNotification[];
    appBaseUrl: string;
}

// Display order matters — shows what's most actionable first.
const GROUP_ORDER = [
    {
        key: 'appointments',
        label: 'Rendez-vous',
        types: ['appointment_reminder_30min', 'appointment_reminder_1hour'],
    },
    { key: 'tasks', label: 'Tâches', types: ['task_due_today', 'task_overdue'] },
    {
        key: 'house',
        label: 'Maison',
        types: ['contract_due_soon', 'maintenance_due_soon', 'warranty_expiring'],
    },
] as const;

const groupLabelFor = (type: string): { key: string; label: string } => {
    for (const group of GROUP_ORDER) {
        if ((group.types as readonly string[]).includes(type)) {
            return { key: group.key, label: group.label };
        }
    }
    return { key: 'other', label: 'Autres' };
};

export const renderDigestEmail = (
    input: DigestEmailInput,
): { subject: string; html: string; text: string } => {
    const { notifications, recipientName, appBaseUrl } = input;
    const baseUrl = appBaseUrl.replace(/\/+$/, '');
    const settingsUrl = `${baseUrl}/settings`;

    const grouped = new Map<string, { label: string; items: DigestNotification[] }>();
    for (const n of notifications) {
        const { key, label } = groupLabelFor(n.type);
        const bucket = grouped.get(key) ?? { label, items: [] };
        bucket.items.push(n);
        grouped.set(key, bucket);
    }

    const total = notifications.length;
    const subject = `[OpenFamily] Récapitulatif — ${total} notification${total > 1 ? 's' : ''}`;

    // Render groups in the canonical order, then any "other" buckets last.
    const orderedKeys = [
        ...GROUP_ORDER.map((g) => g.key).filter((k) => grouped.has(k)),
        ...[...grouped.keys()].filter((k) => !GROUP_ORDER.some((g) => g.key === k)),
    ];

    const sectionsHtml = orderedKeys
        .map((key) => {
            const bucket = grouped.get(key)!;
            const itemsHtml = bucket.items
                .map((n) => {
                    const ctaUrl = `${baseUrl}${notificationPath(n.type)}`;
                    return `
            <li style="margin:0 0 12px 0;padding:12px 14px;background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;list-style:none;">
              <p style="margin:0;font-size:14px;font-weight:600;color:#18181b;">
                <a href="${escapeHtml(ctaUrl)}" style="color:#18181b;text-decoration:none;">${escapeHtml(n.title)}</a>
              </p>
              <p style="margin:4px 0 0 0;font-size:14px;color:#52525b;line-height:1.4;">${escapeHtml(n.message)}</p>
            </li>`;
                })
                .join('');
            return `
        <h2 style="margin:24px 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#71717a;">${escapeHtml(bucket.label)}</h2>
        <ul style="margin:0;padding:0;">${itemsHtml}</ul>`;
        })
        .join('');

    const bodyHtml = `
      <h1 style="margin:16px 0 8px 0;font-size:20px;line-height:1.3;color:#18181b;">Votre récapitulatif du jour</h1>
      <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;">Bonjour ${escapeHtml(recipientName)},</p>
      <p style="margin:0 0 16px 0;font-size:14px;color:#52525b;">Vous avez ${total} notification${total > 1 ? 's' : ''} en attente :</p>
      ${sectionsHtml}
      <p style="margin:24px 0 0 0;">
        <a href="${escapeHtml(baseUrl)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;">Ouvrir OpenFamily</a>
      </p>
    `;

    const html = wrapEmail({ title: subject, bodyHtml, settingsUrl });

    const textLines: string[] = [
        `Bonjour ${recipientName},`,
        '',
        `Votre récapitulatif du jour (${total} notification${total > 1 ? 's' : ''})`,
        '',
    ];
    for (const key of orderedKeys) {
        const bucket = grouped.get(key)!;
        textLines.push(`— ${bucket.label} —`);
        for (const n of bucket.items) {
            textLines.push(`• ${n.title} : ${n.message}`);
        }
        textLines.push('');
    }
    textLines.push(`Ouvrir OpenFamily : ${baseUrl}`);
    textLines.push('');
    textLines.push(`Gérer mes préférences : ${settingsUrl}`);

    return { subject, html, text: textLines.join('\n') };
};
