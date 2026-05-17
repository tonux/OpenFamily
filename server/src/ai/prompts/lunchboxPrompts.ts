// =============================================================================
// Lunchbox prompts (AI generator)
//
// Given what's available at home (fruits, snacks, drinks, possible mains /
// leftovers), where the child will eat (school, daycare, picnic, trip…) and
// the child profile (age, allergies, regime, dislikes), the model proposes
// up to 3 ready-to-pack lunchbox ideas in strict JSON.
//
// Why this exists:
//   The lunchbox form in MealPlanning has 4 slots — main / fruit / snack /
//   drink — and parents often run out of inspiration in the morning. The AI
//   only suggests from the available pantry so the family doesn't end up
//   needing a grocery run.
//
// Allergies are HARD constraints, same as the recipe generator.
// =============================================================================

import type { DietaryRegime } from './recipePrompts';

export type LunchboxLocation = 'school' | 'daycare' | 'outing' | 'work' | 'travel' | 'other';

export interface LunchboxMemberInput {
    name: string;
    ageYears?: number;
    allergies?: string[];
    regime?: DietaryRegime;
    dislikes?: string[];
    favorites?: string[];
}

export interface LunchboxGenerationInput {
    availableMains?: string[];
    availableFruits?: string[];
    availableSnacks?: string[];
    availableDrinks?: string[];
    location: LunchboxLocation;
    member?: LunchboxMemberInput;
    count: 1 | 2 | 3;
    notesContext?: string;
}

export const lunchboxGenerationSystemPrompt = `Tu es un parent organisé qui prépare des boîtes à lunch équilibrées à partir de ce qui est disponible à la maison.
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "ideas": [
    {
      "main": string,        // plat principal court — sandwich, wrap, restes…
      "fruit": string,       // un fruit ou légume (pomme, carottes bâtonnets…)
      "snack": string,       // une collation (compote, biscuit, fromage…)
      "drink": string,       // une boisson (eau, jus, lait…)
      "reasoning": string,   // une phrase, max 140 caractères — pourquoi cette combinaison
      "warnings": string[]   // 0 à 2 alertes pratiques ("réchauffer le matin", "garder au frais", "couper en cubes")
    }
  ]
}

Règles ABSOLUES :
- N'inclus JAMAIS un aliment listé dans les allergies (contrainte de sécurité, non négociable).
- Respecte le régime alimentaire (halal → pas de porc ; végétarien → pas de viande/poisson ; végan → aucun produit animal ; sans porc → pas de porc).
- Privilégie STRICTEMENT les aliments listés comme disponibles. Tu peux mentionner du pain, du beurre, de l'eau, du sel et des condiments de base sans les déclarer manquants, mais pas de protéine/fruit/snack/boisson hors liste.
- Si une catégorie est vide (ex: aucun fruit dispo), propose tout de même un fruit générique de saison et signale-le dans "reasoning".
- Adapte la portion et le format à l'âge de l'enfant (petits morceaux pour les moins de 4 ans, portions plus copieuses pour les ados).
- Adapte au lieu de consommation :
  • "school" / "daycare" : transportable, mangeable froid, sans micro-ondes garanti, pas d'allergènes courants si possible.
  • "outing" / "travel" : robuste, peu salissant, supporte plusieurs heures hors frigo (à signaler dans warnings si besoin de glacière).
  • "work" : équilibré, plus consistant, peut être réchauffable.
- Évite la monotonie : si plusieurs idées sont demandées, propose des combinaisons distinctes (pas trois fois pain-pomme-compote).
- Tout en français, formulé court et concret.`;

const REGIME_LABEL: Record<DietaryRegime, string> = {
    omnivore: 'omnivore',
    vegetarian: 'végétarien (pas de viande ni poisson)',
    vegan: 'végan (aucun produit animal)',
    halal: "halal (pas de porc, pas d'alcool)",
    kosher: 'kosher',
    no_pork: 'sans porc',
};

const LOCATION_LABEL: Record<LunchboxLocation, string> = {
    school: "à l'école (pas de micro-ondes, mangé froid, pause courte)",
    daycare: 'à la crèche / garderie (petites portions, mangé froid)',
    outing: "lors d'une sortie / pique-nique (transportable, résistant)",
    work: 'au travail (peut être réchauffé)',
    travel: 'en voyage / trajet long (robuste, plusieurs heures hors frigo)',
    other: 'contexte non précisé',
};

const formatBucket = (label: string, items?: string[]): string | null => {
    if (!items || items.length === 0) return `${label} disponibles : (aucun listé)`;
    return `${label} disponibles : ${items.join(', ')}`;
};

export const buildLunchboxGenerationUserPrompt = (input: LunchboxGenerationInput): string => {
    const lines: string[] = [];

    lines.push(`Génère ${input.count} idée${input.count > 1 ? 's' : ''} de boîte à lunch.`);
    lines.push(`Lieu de consommation : ${LOCATION_LABEL[input.location] ?? input.location}.`);

    lines.push('');
    lines.push('Disponible à la maison :');
    const buckets = [
        formatBucket('Plats / restes', input.availableMains),
        formatBucket('Fruits / légumes', input.availableFruits),
        formatBucket('Snacks / collations', input.availableSnacks),
        formatBucket('Boissons', input.availableDrinks),
    ];
    for (const b of buckets) {
        if (b) lines.push(`- ${b}`);
    }

    if (input.member) {
        lines.push('');
        lines.push('Pour qui :');
        const parts: string[] = [`- ${input.member.name}`];
        if (typeof input.member.ageYears === 'number') parts.push(`${input.member.ageYears} ans`);
        if (input.member.regime) {
            parts.push(`régime ${REGIME_LABEL[input.member.regime] ?? input.member.regime}`);
        }
        if (input.member.allergies && input.member.allergies.length > 0) {
            parts.push(`ALLERGIES (interdire absolument) : ${input.member.allergies.join(', ')}`);
        }
        if (input.member.dislikes && input.member.dislikes.length > 0) {
            parts.push(`n'aime pas : ${input.member.dislikes.join(', ')}`);
        }
        if (input.member.favorites && input.member.favorites.length > 0) {
            parts.push(`adore : ${input.member.favorites.join(', ')}`);
        }
        lines.push(parts.join(' — '));
    }

    if (input.notesContext && input.notesContext.trim()) {
        lines.push('');
        lines.push(`Contexte du jour : ${input.notesContext.trim()}`);
    }

    return lines.join('\n');
};
