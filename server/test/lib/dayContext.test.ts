import { describe, it, expect } from 'vitest';
import {
    resolveDayContextFrom,
    toDateKey,
    toDateKeyLoose,
    addDays,
    type SchoolBreak,
} from '../../src/lib/dayContext';

// =============================================================================
// Day context resolution.
//
// Pure logic, no DB: every case feeds a date + a list of declared breaks and
// asserts the (mode, reason) pair. 2026-07-13 is a Monday and 2026-07-11 a
// Saturday — both inside the built-in July/August fallback window, which lets
// us check that the weekend rule and the summer rule are distinguishable.
// =============================================================================

const brk = (label: string, start: string, end: string): SchoolBreak => ({
    label,
    start_date: start,
    end_date: end,
});

describe('resolveDayContextFrom', () => {
    it('treats a Saturday as a home day, whatever the season', () => {
        // 2026-02-14 is a Saturday, well outside any break.
        const ctx = resolveDayContextFrom('2026-02-14', []);
        expect(ctx).toEqual({
            date: '2026-02-14',
            mode: 'home',
            reason: 'weekend',
            breakLabel: null,
        });
    });

    it('treats a term-time weekday as a school day', () => {
        // 2026-02-16, a Monday.
        const ctx = resolveDayContextFrom('2026-02-16', []);
        expect(ctx.mode).toBe('school');
        expect(ctx.reason).toBe('school_day');
    });

    it('falls back to July/August when the user declared nothing', () => {
        // 2026-07-13, a Monday — no breaks declared at all.
        const ctx = resolveDayContextFrom('2026-07-13', []);
        expect(ctx.mode).toBe('home');
        expect(ctx.reason).toBe('default_summer');
        expect(ctx.breakLabel).toBeNull();
    });

    it('uses a declared break, carrying its label', () => {
        const breaks = [brk('Vacances de février', '2026-02-14', '2026-03-01')];
        const ctx = resolveDayContextFrom('2026-02-16', breaks);
        expect(ctx.mode).toBe('home');
        expect(ctx.reason).toBe('school_break');
        expect(ctx.breakLabel).toBe('Vacances de février');
    });

    it('includes both bounds of a declared break', () => {
        const breaks = [brk('Toussaint', '2026-10-17', '2026-11-02')];
        // 2026-10-19 and 2026-10-30 are weekdays inside the range; the bounds
        // themselves fall on a weekend, so assert on the first/last weekdays.
        expect(resolveDayContextFrom('2026-10-19', breaks).reason).toBe('school_break');
        expect(resolveDayContextFrom('2026-10-30', breaks).reason).toBe('school_break');
        // The Monday after: back to school.
        expect(resolveDayContextFrom('2026-11-03', breaks).reason).toBe('school_day');
    });

    it('lets a declared summer period override the built-in fallback', () => {
        // The user says summer ends on 2026-08-20. 2026-08-25 (a Tuesday) must
        // then be a school day, even though it sits in the fallback window.
        const breaks = [brk("Vacances d'été", '2026-07-04', '2026-08-20')];
        expect(resolveDayContextFrom('2026-07-13', breaks).reason).toBe('school_break');
        expect(resolveDayContextFrom('2026-08-25', breaks).mode).toBe('school');
    });

    it('keeps the summer fallback when the user only declared an unrelated break', () => {
        // Declaring February must NOT silently disable the July/August default.
        const breaks = [brk('Vacances de février', '2026-02-14', '2026-03-01')];
        const ctx = resolveDayContextFrom('2026-07-13', breaks);
        expect(ctx.mode).toBe('home');
        expect(ctx.reason).toBe('default_summer');
    });

    it('scopes the summer override to the matching year', () => {
        // A 2025 summer declaration must not disable the 2026 fallback.
        const breaks = [brk("Vacances d'été 2025", '2025-07-05', '2025-09-01')];
        expect(resolveDayContextFrom('2026-07-13', breaks).reason).toBe('default_summer');
    });
});

describe('date helpers', () => {
    it('builds a local date key without shifting to UTC', () => {
        // 23:30 local on the 13th must stay the 13th, not roll over to the 14th
        // the way toISOString() would for any timezone east of Greenwich.
        expect(toDateKey(new Date(2026, 6, 13, 23, 30))).toBe('2026-07-13');
    });

    it('parses both Date and string DATE columns', () => {
        expect(toDateKeyLoose(new Date(2026, 6, 13))).toBe('2026-07-13');
        expect(toDateKeyLoose('2026-07-13')).toBe('2026-07-13');
        expect(toDateKeyLoose('2026-07-13T00:00:00.000Z')).toBe('2026-07-13');
        expect(toDateKeyLoose(null)).toBeNull();
        expect(toDateKeyLoose('nope')).toBeNull();
    });

    it('rolls over month boundaries', () => {
        expect(toDateKey(addDays(new Date(2026, 6, 31), 1))).toBe('2026-08-01');
    });
});
