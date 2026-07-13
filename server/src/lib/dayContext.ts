// =============================================================================
// Day context — is a given day a school day, or are the kids home?
//
// The dashboard used to hardcode "Demain — école" 365 days a year. This module
// is the single source of truth that lets the widgets tell the difference, and
// it drives two things:
//   1. which day the dashboard talks about (see `resolveTargetDay`),
//   2. whether we suggest a school outfit or screen-free activities.
//
// Resolution is a pure function of (date, declared breaks) so it is fully
// testable without a database; `resolveDayContext` is the thin DB-backed shell.
// =============================================================================
import { query } from '../db';

export type DayMode = 'school' | 'home';
export type DayReason = 'school_day' | 'weekend' | 'school_break' | 'default_summer';

export interface DayContext {
    /** YYYY-MM-DD */
    date: string;
    mode: DayMode;
    reason: DayReason;
    /** Label of the matching school_breaks row, when reason is 'school_break'. */
    breakLabel: string | null;
}

export interface SchoolBreak {
    label: string;
    /** YYYY-MM-DD, inclusive */
    start_date: string;
    /** YYYY-MM-DD, inclusive */
    end_date: string;
}

/**
 * Fallback summer window, used only when the user has declared nothing that
 * overlaps it. Inclusive bounds, month/day only — the year comes from the date
 * being resolved.
 */
const SUMMER_START = '07-01';
const SUMMER_END = '08-31';

/** Local-calendar YYYY-MM-DD. Avoids toISOString(), which shifts to UTC. */
export const toDateKey = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

export const addDays = (d: Date, days: number): Date => {
    const out = new Date(d);
    out.setDate(out.getDate() + days);
    return out;
};

/**
 * Normalize whatever the pg driver hands back for a DATE column. `pg` maps
 * DATE to a JS Date at local midnight, but a hand-written fixture (or a driver
 * configured with a string parser) may pass the raw 'YYYY-MM-DD'.
 */
export const toDateKeyLoose = (value: unknown): string | null => {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : toDateKey(value);
    if (typeof value === 'string') {
        const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
        return m ? m[1] : null;
    }
    return null;
};

const isWeekend = (dateKey: string): boolean => {
    const day = new Date(`${dateKey}T00:00:00`).getDay();
    return day === 0 || day === 6; // Sunday | Saturday
};

/** Inclusive range test on YYYY-MM-DD strings — lexicographic order is chronological. */
const covers = (b: SchoolBreak, dateKey: string): boolean =>
    b.start_date <= dateKey && dateKey <= b.end_date;

const overlapsSummerOf = (b: SchoolBreak, year: string): boolean => {
    const from = `${year}-${SUMMER_START}`;
    const to = `${year}-${SUMMER_END}`;
    return b.start_date <= to && from <= b.end_date;
};

/**
 * Decide whether the kids are at school or at home on `dateKey`, in order:
 *
 *   1. Weekend                                    → home
 *   2. Covered by a break the user declared       → home (carries its label)
 *   3. July–August, and the user declared nothing overlapping that summer
 *                                                 → home (built-in fallback)
 *   4. Otherwise                                  → school
 *
 * Rule 3 is what makes the feature work out of the box for a user who never
 * opens the settings. It steps aside as soon as the user declares their own
 * summer period — but declaring, say, only a February break does NOT disable
 * it, which is the least surprising behaviour.
 */
export const resolveDayContextFrom = (dateKey: string, breaks: SchoolBreak[]): DayContext => {
    if (isWeekend(dateKey)) {
        return { date: dateKey, mode: 'home', reason: 'weekend', breakLabel: null };
    }

    const declared = breaks.find((b) => covers(b, dateKey));
    if (declared) {
        return {
            date: dateKey,
            mode: 'home',
            reason: 'school_break',
            breakLabel: declared.label,
        };
    }

    const year = dateKey.slice(0, 4);
    const inSummer = dateKey >= `${year}-${SUMMER_START}` && dateKey <= `${year}-${SUMMER_END}`;
    if (inSummer && !breaks.some((b) => overlapsSummerOf(b, year))) {
        return { date: dateKey, mode: 'home', reason: 'default_summer', breakLabel: null };
    }

    return { date: dateKey, mode: 'school', reason: 'school_day', breakLabel: null };
};

export const listSchoolBreaks = async (userId: string): Promise<SchoolBreak[]> => {
    const result = await query(
        `SELECT label, start_date, end_date
         FROM school_breaks
         WHERE user_id = $1
         ORDER BY start_date ASC`,
        [userId],
    );
    const out: SchoolBreak[] = [];
    for (const row of result.rows as Array<Record<string, unknown>>) {
        const start = toDateKeyLoose(row.start_date);
        const end = toDateKeyLoose(row.end_date);
        if (!start || !end) continue;
        out.push({
            label: typeof row.label === 'string' ? row.label : '',
            start_date: start,
            end_date: end,
        });
    }
    return out;
};

export const resolveDayContext = async (userId: string, dateKey: string): Promise<DayContext> =>
    resolveDayContextFrom(dateKey, await listSchoolBreaks(userId));

/**
 * Which day should the dashboard talk about?
 *
 *   - School term: tomorrow. The question that matters is asked in the evening
 *     — pack the bag, lay out the outfit for the morning.
 *   - Holidays: today. The question is asked at breakfast — what do we DO today?
 *
 * Nice side effect: on a Friday (a school day), the target is Saturday, so the
 * activity suggestions land the evening before the weekend, when they're useful.
 */
export const resolveTargetDay = async (
    userId: string,
    now: Date = new Date(),
): Promise<{ context: DayContext; dayOffset: 0 | 1 }> => {
    const breaks = await listSchoolBreaks(userId);

    const today = resolveDayContextFrom(toDateKey(now), breaks);
    if (today.mode === 'home') {
        return { context: today, dayOffset: 0 };
    }

    const tomorrow = resolveDayContextFrom(toDateKey(addDays(now, 1)), breaks);
    return { context: tomorrow, dayOffset: 1 };
};
