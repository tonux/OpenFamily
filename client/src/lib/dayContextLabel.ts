import type { TFunction } from 'i18next';
import type { DayContextDTO } from '../hooks/useDashboardWeather';

// =============================================================================
// Turn a DayContext into the heading the dashboard shows.
//
// The widgets used to hardcode "Demain — école" and print it 365 days a year,
// weekends and August included. This is the one place that decides what the
// heading actually says, so the two cards can never drift apart.
//
// `isToday` mirrors the server's target-day rule (see lib/dayContext.ts): the
// holidays put the question at breakfast ("what do we do today?"), term time
// puts it the evening before ("what do they wear tomorrow?").
// =============================================================================

export const isTodayContext = (ctx: DayContextDTO, now: Date = new Date()): boolean => {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return ctx.date === `${y}-${m}-${d}`;
};

/** e.g. "Demain — école", "Aujourd'hui — vacances d'été", "Aujourd'hui — week-end". */
export const dayContextHeading = (
    ctx: DayContextDTO,
    t: TFunction,
    now: Date = new Date(),
): string => {
    const today = isTodayContext(ctx, now);

    if (ctx.mode === 'school') {
        // A school day is never "today" under the current target-day rule, but
        // don't let the heading lie if that ever changes.
        return today ? t('weatherClothing.today') : t('weatherClothing.tomorrowSchool');
    }

    switch (ctx.reason) {
        case 'weekend':
            return today ? t('weatherClothing.todayWeekend') : t('weatherClothing.tomorrowWeekend');
        case 'school_break': {
            const label = ctx.breakLabel?.trim();
            if (!label) break;
            return today
                ? t('weatherClothing.todayBreak', { label })
                : t('weatherClothing.tomorrowBreak', { label });
        }
        case 'default_summer': {
            const label = t('weatherClothing.defaultSummerLabel');
            return today
                ? t('weatherClothing.todayBreak', { label })
                : t('weatherClothing.tomorrowBreak', { label });
        }
        default:
            break;
    }

    return today ? t('weatherClothing.todayHome') : t('weatherClothing.tomorrowHome');
};
