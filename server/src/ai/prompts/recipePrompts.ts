// =============================================================================
// Recipe prompts (AI generator)
//
// Given a list of ingredients on hand, the family members the meal is for, and
// optional preferences (cuisine, max time, "simple plats" mode), the model
// returns up to 3 recipe propositions in strict JSON.
//
// Why JSON-only and capped output?
//   - Routes auto-save the chosen recipe via POST /api/recipes — the JSON
//     shape mirrors the Recipe entity so no transformation is needed.
//   - Capping arrays (max ingredients, max steps) keeps tokens down and
//     guarantees the 8B default model stays coherent.
//
// Allergies coming from family_members are passed as HARD constraints. The
// system prompt is explicit: never include or suggest a banned ingredient.
// =============================================================================

// Inlined locally because the server has no dep on @keurtonux/shared.
// Keep this list in sync with shared/src/types.ts (DietaryRegime, SpiceLevel).
export type DietaryRegime = 'omnivore' | 'vegetarian' | 'vegan' | 'halal' | 'kosher' | 'no_pork';
export type SpiceLevel = 'none' | 'mild' | 'medium' | 'hot';

export interface RecipeMemberInput {
    name: string;
    ageYears?: number;
    allergies?: string[];
    regime?: DietaryRegime;
    spice_level?: SpiceLevel;
    dislikes?: string[];
    favorites?: string[];
}

export interface RecipeGenerationInput {
    ingredients: string[];
    members: RecipeMemberInput[];
    cuisine?: 'senegalese' | 'world' | 'any';
    simple?: boolean;
    maxTimeMinutes?: number;
    count: 1 | 2 | 3;
}

export const recipeGenerationSystemPrompt = `Tu es un chef de cuisine familial bienveillant qui propose des recettes adaptées à une famille.
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "recipes": [
    {
      "name": string,                  // titre court et appétissant
      "category": "Entrée" | "Plat" | "Dessert" | "Snack",
      "description": string,           // une phrase, max 160 caractères
      "ingredients": string[],         // 3 à 12 lignes, format "200 g de poulet"
      "instructions": string[],        // 4 à 10 étapes courtes, à l'impératif
      "prep_time": number,             // minutes
      "cook_time": number,             // minutes
      "servings": number,              // nombre de personnes
      "difficulty": "Facile" | "Moyen" | "Difficile",
      "tags": string[]                 // 1 à 5 mots-clés ("rapide", "sénégalais", "végétarien"…)
    }
  ]
}

Règles ABSOLUES :
- N'inclus JAMAIS un ingrédient listé dans les allergies (contrainte de sécurité, non négociable).
- Respecte le régime alimentaire de chaque membre (halal → pas de porc/alcool ; végétarien → pas de viande/poisson ; végan → pas d'animal du tout ; sans porc → pas de porc).
- Évite autant que possible les ingrédients dans la liste "n'aime pas" (sauf si vraiment indispensable, alors mentionne-le dans description).
- Privilégie les ingrédients disponibles dans la liste fournie. Tu peux ajouter des basiques (sel, huile, oignon, ail, eau) sans les compter comme manquants.
- Quand "plats simples" est demandé : 6 à 8 ingrédients max, 4 à 6 étapes max, ≤ 45 min total, difficulté "Facile".
- Quand "cuisine sénégalaise" est demandée : propose Yassa, Thiéboudienne, Mafé, Domoda, Bissap, etc., avec des ingrédients authentiques (riz brisé, nététou, gombo…).
- Génère exactement le nombre de recettes demandé, variées entre elles (pas trois fois le même plat).
- Tout en français, instructions à l'impératif ("Émincez les oignons.", "Faites revenir…").`;

const REGIME_LABEL: Record<DietaryRegime, string> = {
    omnivore: 'omnivore',
    vegetarian: 'végétarien (pas de viande ni poisson)',
    vegan: 'végan (aucun produit animal)',
    halal: "halal (pas de porc, pas d'alcool)",
    kosher: 'kosher',
    no_pork: 'sans porc',
};

const SPICE_LABEL: Record<SpiceLevel, string> = {
    none: 'sans épices fortes',
    mild: 'épices douces',
    medium: 'épices moyennes',
    hot: 'aime le piquant',
};

export const buildRecipeGenerationUserPrompt = (input: RecipeGenerationInput): string => {
    const lines: string[] = [];

    lines.push(`Génère ${input.count} recette${input.count > 1 ? 's différentes' : ''}.`);

    if (input.cuisine === 'senegalese') {
        lines.push('Style de cuisine : sénégalaise / ouest-africaine.');
    } else if (input.cuisine === 'world') {
        lines.push('Style de cuisine : du monde, varié.');
    }

    if (input.simple) {
        lines.push('Mode "plats simples" activé : recettes faciles, peu d\'ingrédients, courtes.');
    }
    if (input.maxTimeMinutes) {
        lines.push(
            `Temps total maximum : ${input.maxTimeMinutes} minutes (préparation + cuisson).`,
        );
    }

    lines.push('');
    lines.push('Ingrédients disponibles :');
    for (const ing of input.ingredients) {
        lines.push(`- ${ing}`);
    }

    if (input.members.length > 0) {
        lines.push('');
        lines.push('Pour qui (contraintes par personne) :');
        for (const m of input.members) {
            const parts: string[] = [`- ${m.name}`];
            if (typeof m.ageYears === 'number') parts.push(`${m.ageYears} ans`);
            if (m.regime) parts.push(`régime ${REGIME_LABEL[m.regime] ?? m.regime}`);
            if (m.spice_level) parts.push(SPICE_LABEL[m.spice_level] ?? m.spice_level);
            if (m.allergies && m.allergies.length > 0) {
                parts.push(`ALLERGIES (interdire absolument) : ${m.allergies.join(', ')}`);
            }
            if (m.dislikes && m.dislikes.length > 0) {
                parts.push(`n'aime pas : ${m.dislikes.join(', ')}`);
            }
            if (m.favorites && m.favorites.length > 0) {
                parts.push(`adore : ${m.favorites.join(', ')}`);
            }
            lines.push(parts.join(' — '));
        }
    }

    return lines.join('\n');
};
