// =============================================================================
// Scheduling rules for the seasonal care program.
//
// Two things make this less trivial than "last_done + N months":
//
//   1. Seasonal windows wrap. Winter is month_start=12, month_end=2, so the
//      "is this month inside the window" test can't be a plain range compare.
//   2. A seasonal task must land IN its window. Cleaning the gutters six months
//      after the last time would schedule it for April if you did it in
//      October — but the whole point is that it happens before the leaves
//      freeze in. So the raw recurrence date gets snapped forward to the next
//      opening of the window.
//
// All dates are handled as 'YYYY-MM-DD' strings in UTC. The DB stores DATE
// (no time zone), and going through local-time Date objects is how you end up
// with tasks that shift a day depending on who's looking.
// =============================================================================

export type IsoDate = string; // 'YYYY-MM-DD'

export const toIsoDate = (d: Date): IsoDate => d.toISOString().slice(0, 10);

/** Parse 'YYYY-MM-DD' into a UTC-noon Date — noon avoids any DST edge. */
export const parseIsoDate = (iso: IsoDate): Date => new Date(`${iso}T12:00:00.000Z`);

export const addDays = (iso: IsoDate, days: number): IsoDate => {
    const d = parseIsoDate(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return toIsoDate(d);
};

export const addMonths = (iso: IsoDate, months: number): IsoDate => {
    const d = parseIsoDate(iso);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    // Clamp: 31 janvier + 1 mois doit donner le 28/29 février, pas le 3 mars.
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return toIsoDate(d);
};

export const daysBetween = (from: IsoDate, to: IsoDate): number =>
    Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000);

/**
 * Is `month` (1-12) inside the window? A window with either bound null is
 * "any month". Wrapping windows (12 → 2) are supported and common.
 */
export const isMonthInWindow = (
    month: number,
    start: number | null | undefined,
    end: number | null | undefined,
): boolean => {
    if (start == null || end == null) return true;
    if (start <= end) return month >= start && month <= end;
    return month >= start || month <= end;
};

/**
 * First day on or after `from` that falls inside the [start, end] month window.
 * Returns `from` unchanged when it's already inside, or when there's no window.
 */
export const snapIntoWindow = (
    from: IsoDate,
    start: number | null | undefined,
    end: number | null | undefined,
): IsoDate => {
    if (start == null || end == null) return from;
    const d = parseIsoDate(from);
    if (isMonthInWindow(d.getUTCMonth() + 1, start, end)) return from;

    // Walk forward month by month to the window opening. Bounded by 12 steps —
    // any window is reachable within a year by construction.
    for (let i = 1; i <= 12; i += 1) {
        const candidate = parseIsoDate(from);
        candidate.setUTCDate(1);
        candidate.setUTCMonth(candidate.getUTCMonth() + i);
        if (isMonthInWindow(candidate.getUTCMonth() + 1, start, end)) {
            return toIsoDate(candidate);
        }
    }
    return from;
};

export interface SchedulableTask {
    frequency: string;
    interval_months: number | null;
    month_start: number | null;
    month_end: number | null;
}

/**
 * Next due date after a completion on `doneOn`.
 *
 * Weekly tasks recur on a plain 7-day cadence — they're the routine tour and
 * pinning them to a calendar window would just make them look overdue all the
 * time. Everything else advances by `interval_months`, then snaps forward into
 * its seasonal window when it has one.
 */
export const nextDueAfterCompletion = (task: SchedulableTask, doneOn: IsoDate): IsoDate => {
    if (task.frequency === 'Hebdomadaire' || task.interval_months == null) {
        return addDays(doneOn, 7);
    }
    const raw = addMonths(doneOn, task.interval_months);
    return snapIntoWindow(raw, task.month_start, task.month_end);
};

/**
 * Initial due date for a task that has never been done — used at seed time and
 * when the AI proposal is accepted.
 *
 * Windowless routine (weekly, monthly, quarterly) starts now: it's the habit we
 * want the user to pick up today. A seasonal task starts at the next opening of
 * its window, so seeding 50 tasks in August doesn't dump the entire autumn and
 * winter program into "à faire" on day one.
 */
export const initialDueDate = (task: SchedulableTask, today: IsoDate): IsoDate => {
    if (task.month_start == null || task.month_end == null) return today;
    return snapIntoWindow(today, task.month_start, task.month_end);
};

/** 'Printemps' | 'Été' | 'Automne' | 'Hiver' for a 1-12 month, northern hemisphere. */
export const seasonForMonth = (month: number): 'Printemps' | 'Été' | 'Automne' | 'Hiver' => {
    if (month >= 3 && month <= 5) return 'Printemps';
    if (month >= 6 && month <= 8) return 'Été';
    if (month >= 9 && month <= 11) return 'Automne';
    return 'Hiver';
};

/**
 * Is the task relevant right now? A task is "in season" when its season is
 * "Toute l'année", matches the current season, or its explicit month window
 * covers the current month. The explicit window wins when both are present —
 * it's the more precise statement (ice-dam watch is 'Hiver' but runs 12 → 3).
 */
export const isInSeason = (
    task: { season: string; month_start: number | null; month_end: number | null },
    month: number,
): boolean => {
    if (task.month_start != null && task.month_end != null) {
        return isMonthInWindow(month, task.month_start, task.month_end);
    }
    if (task.season === "Toute l'année") return true;
    return task.season === seasonForMonth(month);
};
