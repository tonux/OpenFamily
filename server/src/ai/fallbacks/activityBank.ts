// =============================================================================
// Static activity bank — the safety net behind the AI suggestions.
//
// When the AI is off, over quota, or returns garbage, the widget must still
// show something: an empty "what shall we do today?" card loses the argument
// against the screen by default. So we degrade to a curated bank rather than
// to nothing.
//
// Ideas are tagged by age range and by whether they need decent weather. The
// picker mirrors the AI's contract exactly (same fields, same slugs), so the
// client renders both paths through one component.
// =============================================================================

import type { ActivityCategory, ActivityTimeOfDay } from '../prompts/activityPrompts';

export interface BankActivity {
    title: string;
    category: ActivityCategory;
    timeOfDay: ActivityTimeOfDay;
    durationMinutes: number;
    materials: string[];
    instructions: string;
    ageMin: number;
    ageMax: number;
    /** true → needs dry, not-freezing weather. */
    outdoor: boolean;
}

const BANK: BankActivity[] = [
    // --- Outdoor ---------------------------------------------------------
    {
        title: 'Chasse au trésor dans le jardin',
        category: 'outdoor',
        timeOfDay: 'morning',
        durationMinutes: 45,
        materials: ['papier', 'crayon'],
        instructions: 'Cachez cinq objets, dessinez une carte et lancez la recherche.',
        ageMin: 3,
        ageMax: 10,
        outdoor: true,
    },
    {
        title: 'Parcours du combattant maison',
        category: 'sport',
        timeOfDay: 'afternoon',
        durationMinutes: 40,
        materials: ['coussins', 'chaises', 'corde'],
        instructions: 'Montez un parcours dans le jardin et chronométrez chaque passage.',
        ageMin: 4,
        ageMax: 12,
        outdoor: true,
    },
    {
        title: 'Herbier des plantes du quartier',
        category: 'learning',
        timeOfDay: 'morning',
        durationMinutes: 60,
        materials: ['carnet', 'colle'],
        instructions: 'Ramassez des feuilles, faites-les sécher et collez-les avec leur nom.',
        ageMin: 6,
        ageMax: 13,
        outdoor: true,
    },
    {
        title: 'Pique-nique préparé par les enfants',
        category: 'cooking',
        timeOfDay: 'morning',
        durationMinutes: 90,
        materials: ['pain', 'nappe'],
        instructions:
            'Ils composent le menu, préparent tout et choisissent le coin du pique-nique.',
        ageMin: 5,
        ageMax: 14,
        outdoor: true,
    },
    {
        title: 'Course de bateaux en papier',
        category: 'creative',
        timeOfDay: 'afternoon',
        durationMinutes: 30,
        materials: ['papier', 'bassine'],
        instructions:
            'Pliez des bateaux, remplissez une bassine et soufflez pour les faire courir.',
        ageMin: 4,
        ageMax: 9,
        outdoor: true,
    },
    {
        title: 'Arroser et désherber le potager',
        category: 'chores',
        timeOfDay: 'evening',
        durationMinutes: 30,
        materials: ['arrosoir'],
        instructions: 'Chacun prend une rangée. On arrose le soir pour éviter l’évaporation.',
        ageMin: 4,
        ageMax: 14,
        outdoor: true,
    },
    {
        title: 'Land art avec ce qu’on trouve dehors',
        category: 'creative',
        timeOfDay: 'afternoon',
        durationMinutes: 45,
        materials: ['cailloux', 'feuilles'],
        instructions:
            'Composez une œuvre au sol avec des éléments naturels, puis photographiez-la.',
        ageMin: 5,
        ageMax: 12,
        outdoor: true,
    },
    {
        title: 'Olympiades de quartier',
        category: 'sport',
        timeOfDay: 'afternoon',
        durationMinutes: 90,
        materials: ['craie', 'chronomètre'],
        instructions: 'Invitez les voisins, inventez cinq épreuves et tenez un tableau des scores.',
        ageMin: 6,
        ageMax: 14,
        outdoor: true,
    },
    {
        title: 'Cabane en draps et branches',
        category: 'outdoor',
        timeOfDay: 'morning',
        durationMinutes: 75,
        materials: ['draps', 'pinces à linge'],
        instructions: 'Construisez une cabane, puis passez-y le goûter.',
        ageMin: 3,
        ageMax: 11,
        outdoor: true,
    },

    // --- Indoor ----------------------------------------------------------
    {
        title: 'Atelier pâtisserie : cookies',
        category: 'cooking',
        timeOfDay: 'afternoon',
        durationMinutes: 75,
        materials: ['farine', 'beurre', 'sucre'],
        instructions: 'Ils pèsent, mélangent et façonnent. Vous ne faites qu’ouvrir le four.',
        ageMin: 4,
        ageMax: 14,
        outdoor: false,
    },
    {
        title: 'Fabriquer un jeu de société',
        category: 'creative',
        timeOfDay: 'afternoon',
        durationMinutes: 90,
        materials: ['carton', 'feutres', 'dés'],
        instructions: 'Inventez le plateau, les règles et les pions, puis testez-le en famille.',
        ageMin: 6,
        ageMax: 14,
        outdoor: false,
    },
    {
        title: 'Théâtre d’ombres',
        category: 'creative',
        timeOfDay: 'evening',
        durationMinutes: 60,
        materials: ['lampe', 'drap', 'carton'],
        instructions: 'Découpez des personnages, tendez un drap et jouez l’histoire aux parents.',
        ageMin: 4,
        ageMax: 11,
        outdoor: false,
    },
    {
        title: 'Défi de construction en 30 minutes',
        category: 'learning',
        timeOfDay: 'morning',
        durationMinutes: 30,
        materials: ['briques', 'carton', 'ruban adhésif'],
        instructions: 'La tour la plus haute qui tient debout dix secondes. Chronomètre lancé.',
        ageMin: 4,
        ageMax: 12,
        outdoor: false,
    },
    {
        title: 'Écrire et illustrer une histoire',
        category: 'creative',
        timeOfDay: 'afternoon',
        durationMinutes: 60,
        materials: ['papier', 'crayons de couleur'],
        instructions: 'Un chapitre chacun, une illustration par page, puis lecture à voix haute.',
        ageMin: 6,
        ageMax: 13,
        outdoor: false,
    },
    {
        title: 'Rangement chronométré en musique',
        category: 'chores',
        timeOfDay: 'morning',
        durationMinutes: 20,
        materials: [],
        instructions: 'Une chanson, une pièce. Tout ce qui traîne rejoint sa place avant la fin.',
        ageMin: 3,
        ageMax: 14,
        outdoor: false,
    },
    {
        title: 'Expériences de cuisine scientifique',
        category: 'learning',
        timeOfDay: 'afternoon',
        durationMinutes: 45,
        materials: ['vinaigre', 'bicarbonate', 'colorant'],
        instructions: 'Volcan, encre invisible, densité des liquides. On note ce qu’on observe.',
        ageMin: 6,
        ageMax: 13,
        outdoor: false,
    },
    {
        title: 'Yoga et parcours d’équilibre',
        category: 'sport',
        timeOfDay: 'morning',
        durationMinutes: 30,
        materials: ['tapis', 'ruban adhésif'],
        instructions:
            'Une ligne au sol, des postures à tenir dix secondes, on augmente à chaque tour.',
        ageMin: 4,
        ageMax: 12,
        outdoor: false,
    },
    {
        title: 'Appeler et interviewer les grands-parents',
        category: 'social',
        timeOfDay: 'evening',
        durationMinutes: 30,
        materials: ['carnet'],
        instructions: 'Cinq questions préparées sur leur enfance, et on écrit les réponses.',
        ageMin: 5,
        ageMax: 14,
        outdoor: false,
    },
    {
        title: 'Cartes postales pour les copains',
        category: 'creative',
        timeOfDay: 'afternoon',
        durationMinutes: 45,
        materials: ['carton', 'feutres', 'timbres'],
        instructions:
            'Chacun dessine sa carte, écrit un mot et l’adresse. Passage à la boîte aux lettres.',
        ageMin: 5,
        ageMax: 12,
        outdoor: false,
    },
    {
        title: 'Trier ses jouets pour les donner',
        category: 'chores',
        timeOfDay: 'morning',
        durationMinutes: 45,
        materials: ['cartons'],
        instructions:
            'Trois piles : garder, donner, réparer. Ils choisissent, vous n’arbitrez pas.',
        ageMin: 5,
        ageMax: 14,
        outdoor: false,
    },
];

export interface PickedActivity {
    kidIds: string[];
    title: string;
    category: ActivityCategory;
    timeOfDay: ActivityTimeOfDay;
    durationMinutes: number;
    materials: string[];
    instructions: string;
}

const TIME_ORDER: Record<ActivityTimeOfDay, number> = { morning: 0, afternoon: 1, evening: 2 };

/**
 * Pick 3–5 age-appropriate, weather-appropriate ideas, spread across the day.
 *
 * Deterministic for a given (date, kids, weather) so a dashboard refresh does
 * not reshuffle the card under the user's eyes — but the date seed means a new
 * day brings different ideas. `exclude` lets the "regenerate" button move past
 * what has already been shown.
 */
export const pickFallbackActivities = (opts: {
    kids: Array<{ id: string; ageYears: number }>;
    /** false when it rains, blows hard, or freezes. */
    outdoorOk: boolean;
    /** YYYY-MM-DD — seeds the rotation. */
    dateKey: string;
    exclude?: string[];
}): PickedActivity[] => {
    const { kids, outdoorOk, dateKey, exclude = [] } = opts;
    if (kids.length === 0) return [];

    const excluded = new Set(exclude.map((t) => t.trim().toLowerCase()));
    const ages = kids.map((k) => k.ageYears);
    const minAge = Math.min(...ages);
    const maxAge = Math.max(...ages);

    const eligible = BANK.filter((a) => {
        if (excluded.has(a.title.toLowerCase())) return false;
        if (a.outdoor && !outdoorOk) return false;
        // Keep an idea if it suits at least one of the kids.
        return a.ageMin <= maxAge && a.ageMax >= minAge;
    });
    if (eligible.length === 0) return [];

    // Rotate the bank by a seed derived from the date, so the selection changes
    // day to day without any randomness (which would break caching and make the
    // card flicker between renders).
    const seed = [...dateKey].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 100_000, 7);
    const rotated = eligible.map((_, i) => eligible[(i + seed) % eligible.length]);

    // Spread across the day: take the best match per time slot first, then fill.
    const picked: BankActivity[] = [];
    for (const slot of ['morning', 'afternoon', 'evening'] as ActivityTimeOfDay[]) {
        const found = rotated.find((a) => a.timeOfDay === slot && !picked.includes(a));
        if (found) picked.push(found);
    }
    for (const a of rotated) {
        if (picked.length >= 4) break;
        if (!picked.includes(a)) picked.push(a);
    }

    return (
        picked
            .sort((a, b) => TIME_ORDER[a.timeOfDay] - TIME_ORDER[b.timeOfDay])
            .map((a) => ({
                kidIds: kids
                    .filter((k) => a.ageMin <= k.ageYears && k.ageYears <= a.ageMax)
                    .map((k) => k.id),
                title: a.title,
                category: a.category,
                timeOfDay: a.timeOfDay,
                durationMinutes: a.durationMinutes,
                materials: a.materials,
                instructions: a.instructions,
            }))
            // An idea nobody in the family fits is noise — drop it.
            .filter((a) => a.kidIds.length > 0)
    );
};
