import { describe, it, expect } from 'vitest';
import {
    addDays,
    addMonths,
    daysBetween,
    initialDueDate,
    isInSeason,
    isMonthInWindow,
    nextDueAfterCompletion,
    seasonForMonth,
    snapIntoWindow,
} from '../../src/lib/houseCareSchedule';
import {
    climateFamilyFor,
    requirementsForProfile,
    selectCatalogForProfile,
    HOUSE_CARE_CATALOG,
} from '../../src/lib/houseCareCatalog';

// =============================================================================
// Care scheduling — pure logic, no DB.
//
// The cases that matter are the ones a naive "last_done + N months" gets wrong:
// wrapping winter windows, a seasonal task completed outside its window, and
// month-end clamping.
// =============================================================================

describe('isMonthInWindow', () => {
    it('handles a normal (non-wrapping) window', () => {
        expect(isMonthInWindow(5, 4, 6)).toBe(true);
        expect(isMonthInWindow(3, 4, 6)).toBe(false);
        expect(isMonthInWindow(7, 4, 6)).toBe(false);
    });

    it('handles a window that wraps the year end (winter: 12 → 2)', () => {
        expect(isMonthInWindow(12, 12, 2)).toBe(true);
        expect(isMonthInWindow(1, 12, 2)).toBe(true);
        expect(isMonthInWindow(2, 12, 2)).toBe(true);
        expect(isMonthInWindow(3, 12, 2)).toBe(false);
        expect(isMonthInWindow(11, 12, 2)).toBe(false);
    });

    it('treats a missing bound as "any month"', () => {
        expect(isMonthInWindow(7, null, null)).toBe(true);
        expect(isMonthInWindow(7, 3, null)).toBe(true);
    });
});

describe('addMonths', () => {
    it('clamps to the end of a shorter month', () => {
        expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
        expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
        expect(addMonths('2026-08-31', 1)).toBe('2026-09-30');
    });

    it('crosses the year boundary', () => {
        expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    });
});

describe('addDays / daysBetween', () => {
    it('round-trips across a month boundary', () => {
        expect(addDays('2026-08-30', 5)).toBe('2026-09-04');
        expect(daysBetween('2026-08-30', '2026-09-04')).toBe(5);
    });

    it('returns a negative count when the target is in the past', () => {
        expect(daysBetween('2026-09-04', '2026-08-30')).toBe(-5);
    });
});

describe('snapIntoWindow', () => {
    it('leaves a date already inside the window untouched', () => {
        expect(snapIntoWindow('2026-10-15', 10, 11)).toBe('2026-10-15');
    });

    it('moves a date forward to the window opening', () => {
        expect(snapIntoWindow('2026-06-15', 10, 11)).toBe('2026-10-01');
    });

    it('reaches a wrapping window from outside it', () => {
        // June, window is December → February: the next opening is December.
        expect(snapIntoWindow('2026-06-15', 12, 2)).toBe('2026-12-01');
    });

    it('stays put inside the January half of a wrapping window', () => {
        expect(snapIntoWindow('2027-01-20', 12, 2)).toBe('2027-01-20');
    });
});

describe('nextDueAfterCompletion', () => {
    const seasonal = {
        frequency: 'Annuel',
        interval_months: 12,
        month_start: 10,
        month_end: 11,
    };

    it('recurs weekly tasks on a 7-day cadence, ignoring windows', () => {
        const weekly = {
            frequency: 'Hebdomadaire',
            interval_months: null,
            month_start: 12,
            month_end: 3,
        };
        expect(nextDueAfterCompletion(weekly, '2026-08-26')).toBe('2026-09-02');
    });

    it('keeps an annual seasonal task inside its window', () => {
        expect(nextDueAfterCompletion(seasonal, '2026-10-20')).toBe('2027-10-20');
    });

    it('snaps forward when the raw recurrence would land outside the window', () => {
        // Cleaning gutters late, in December: +12 months is December again,
        // which is outside the Oct-Nov window — it must move to next October,
        // not schedule the job for a frozen December.
        const seasonalSixMonths = { ...seasonal, interval_months: 6 };
        expect(nextDueAfterCompletion(seasonalSixMonths, '2026-10-20')).toBe('2027-10-01');
    });

    it('falls back to weekly cadence when interval_months is missing', () => {
        const broken = {
            frequency: 'Annuel',
            interval_months: null,
            month_start: null,
            month_end: null,
        };
        expect(nextDueAfterCompletion(broken, '2026-08-26')).toBe('2026-09-02');
    });
});

describe('initialDueDate', () => {
    it('makes windowless routine due immediately', () => {
        const monthly = {
            frequency: 'Mensuel',
            interval_months: 1,
            month_start: null,
            month_end: null,
        };
        expect(initialDueDate(monthly, '2026-08-26')).toBe('2026-08-26');
    });

    it('defers a seasonal task to the next opening of its window', () => {
        const fall = { frequency: 'Annuel', interval_months: 12, month_start: 10, month_end: 11 };
        expect(initialDueDate(fall, '2026-08-26')).toBe('2026-10-01');
    });
});

describe('seasonForMonth / isInSeason', () => {
    it('maps months to northern-hemisphere seasons', () => {
        expect(seasonForMonth(1)).toBe('Hiver');
        expect(seasonForMonth(4)).toBe('Printemps');
        expect(seasonForMonth(7)).toBe('Été');
        expect(seasonForMonth(10)).toBe('Automne');
    });

    it('lets an explicit window override the season label', () => {
        // Ice-dam watch is labelled 'Hiver' but runs December → March, so it
        // must still be in season in March even though March is 'Printemps'.
        const iceDams = { season: 'Hiver', month_start: 12, month_end: 3 };
        expect(isInSeason(iceDams, 3)).toBe(true);
        expect(isInSeason(iceDams, 6)).toBe(false);
    });

    it('keeps year-round tasks always in season', () => {
        const always = { season: "Toute l'année", month_start: null, month_end: null };
        expect(isInSeason(always, 1)).toBe(true);
        expect(isInSeason(always, 7)).toBe(true);
    });
});

describe('catalog selection', () => {
    it('classifies climate labels into families', () => {
        expect(climateFamilyFor('Continental humide (hivers rigoureux)')).toBe('cold');
        expect(climateFamilyFor('Tempéré océanique')).toBe('temperate');
        expect(climateFamilyFor('Tropical / chaud')).toBe('hot');
        // Unknown labels fall back to cold: showing an inapplicable task is a
        // dismissal, hiding an applicable one is a burst pipe.
        expect(climateFamilyFor(null)).toBe('cold');
    });

    it('derives requirements from a profile row', () => {
        const req = requirementsForProfile({
            has_basement: true,
            has_sump_pump: true,
            heating_types: ['Thermopompe', 'Poêle à bois'],
            dwelling_type: 'Unifamiliale',
        });
        expect(req.has('basement')).toBe(true);
        expect(req.has('sumpPump')).toBe(true);
        expect(req.has('heatPump')).toBe(true);
        expect(req.has('woodStove')).toBe(true);
        expect(req.has('yard')).toBe(true);
        expect(req.has('pool')).toBe(false);
    });

    it('drops yard-bound tasks for a condo', () => {
        const req = requirementsForProfile({ dwelling_type: 'Condo', heating_types: [] });
        expect(req.has('yard')).toBe(false);
    });

    it('filters the catalog to what applies, and never proposes pool tasks without a pool', () => {
        const selected = selectCatalogForProfile({
            climate: 'cold',
            requirements: requirementsForProfile({
                has_basement: true,
                has_sump_pump: true,
                heating_types: ['Thermopompe', 'Poêle à bois'],
                dwelling_type: 'Unifamiliale',
            }),
        });
        const keys = selected.map((e) => e.key);
        expect(keys).toContain('fall-outdoor-faucets');
        expect(keys).toContain('summer-chimney-sweep');
        expect(keys).toContain('weekly-sump-pump');
        expect(keys).not.toContain('summer-pool-care');
        expect(keys).not.toContain('summer-septic');
        expect(selected.length).toBeGreaterThan(30);
        expect(selected.length).toBeLessThan(HOUSE_CARE_CATALOG.length);
    });

    it('drops freeze-related tasks in a hot climate', () => {
        const selected = selectCatalogForProfile({
            climate: 'hot',
            requirements: requirementsForProfile({
                has_basement: false,
                heating_types: [],
                dwelling_type: 'Unifamiliale',
            }),
        });
        const keys = selected.map((e) => e.key);
        expect(keys).not.toContain('winter-pipe-freeze');
        expect(keys).not.toContain('weekly-ice-dams');
        expect(keys).not.toContain('fall-outdoor-faucets');
    });

    it('gives every catalog entry a stated consequence and a unique key', () => {
        const keys = new Set<string>();
        for (const entry of HOUSE_CARE_CATALOG) {
            expect(entry.riskIfSkipped.length).toBeGreaterThan(20);
            expect(entry.steps.length).toBeGreaterThan(0);
            expect(keys.has(entry.key)).toBe(false);
            keys.add(entry.key);
            // A half-specified window silently behaves as no window at all.
            expect((entry.monthStart == null) === (entry.monthEnd == null)).toBe(true);
            if (entry.frequency === 'Hebdomadaire') {
                expect(entry.intervalMonths).toBeNull();
            } else {
                expect(entry.intervalMonths).not.toBeNull();
            }
        }
    });
});
