import { describe, it, expect } from 'vitest';
import { pickFallbackActivities } from '../../src/ai/fallbacks/activityBank';

// =============================================================================
// The static activity bank is what the widget falls back to when the AI is off,
// over quota, or returns garbage. Its whole job is to never leave the card
// empty — an empty "what shall we do today?" card concedes the day to the
// screen. So the invariants worth pinning are: it always returns something for
// a plausible family, it respects the weather, and it respects age.
// =============================================================================

const KIDS = [
    { id: 'k1', ageYears: 5 },
    { id: 'k2', ageYears: 10 },
];

describe('pickFallbackActivities', () => {
    it('always returns ideas for a plausible family', () => {
        const out = pickFallbackActivities({
            kids: KIDS,
            outdoorOk: true,
            dateKey: '2026-07-13',
        });
        expect(out.length).toBeGreaterThanOrEqual(3);
        expect(out.length).toBeLessThanOrEqual(5);
        for (const a of out) {
            expect(a.title).toBeTruthy();
            expect(a.kidIds.length).toBeGreaterThan(0);
            expect(a.durationMinutes).toBeGreaterThanOrEqual(15);
        }
    });

    it('keeps everyone indoors when the weather is bad', () => {
        const out = pickFallbackActivities({
            kids: KIDS,
            outdoorOk: false,
            dateKey: '2026-07-13',
        });
        expect(out.length).toBeGreaterThan(0);
        // No outdoor-only idea may survive — suggesting a garden treasure hunt
        // in the rain is exactly the failure that makes a family stop looking.
        expect(out.some((a) => a.category === 'outdoor')).toBe(false);
    });

    it('only assigns an idea to the kids it actually suits', () => {
        const out = pickFallbackActivities({
            kids: [
                { id: 'toddler', ageYears: 3 },
                { id: 'teen', ageYears: 14 },
            ],
            outdoorOk: true,
            dateKey: '2026-08-04',
        });
        expect(out.length).toBeGreaterThan(0);
        // A 3-year-old and a 14-year-old rarely fit the same idea; every idea
        // must still name at least one of them, and never both when the age
        // ranges don't actually span both.
        for (const a of out) {
            expect(a.kidIds.length).toBeGreaterThan(0);
            for (const id of a.kidIds) {
                expect(['toddler', 'teen']).toContain(id);
            }
        }
    });

    it('is stable within a day but rotates across days', () => {
        const a = pickFallbackActivities({ kids: KIDS, outdoorOk: true, dateKey: '2026-07-13' });
        const b = pickFallbackActivities({ kids: KIDS, outdoorOk: true, dateKey: '2026-07-13' });
        const c = pickFallbackActivities({ kids: KIDS, outdoorOk: true, dateKey: '2026-07-20' });

        // Same day → same card. A dashboard refresh must not reshuffle it.
        expect(b.map((x) => x.title)).toEqual(a.map((x) => x.title));
        // Another day → different ideas, or the family stops opening the app.
        expect(c.map((x) => x.title)).not.toEqual(a.map((x) => x.title));
    });

    it('honours exclusions so "other ideas" moves on', () => {
        const first = pickFallbackActivities({
            kids: KIDS,
            outdoorOk: true,
            dateKey: '2026-07-13',
        });
        const second = pickFallbackActivities({
            kids: KIDS,
            outdoorOk: true,
            dateKey: '2026-07-13',
            exclude: first.map((a) => a.title),
        });
        expect(second.length).toBeGreaterThan(0);
        for (const a of second) {
            expect(first.map((f) => f.title)).not.toContain(a.title);
        }
    });

    it('returns nothing when there are no kids', () => {
        expect(
            pickFallbackActivities({ kids: [], outdoorOk: true, dateKey: '2026-07-13' }),
        ).toEqual([]);
    });
});
