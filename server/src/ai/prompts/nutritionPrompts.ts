// =============================================================================
// Nutrition prompts (weekly meal analysis)
//
// Given a week of planned meals (date × meal type × recipe-or-custom name),
// the model returns a structured nutritional verdict + actionable advice.
//
// Why force a "score" + buckets?
//   - The UI renders a gauge and three lists (strengths / weaknesses / recos).
//     Forcing a numeric score and well-known buckets means the front never has
//     to interpret free text — every key has a known type.
//   - Buckets are clamped server-side (sanitization) to avoid the model
//     spamming 12 recommendations or empty arrays.
//
// Cultural framing: the family is Senegalese. Examples in the system prompt
// reference local dishes (Yassa, Thieboudienne, Mafé, Bissap, Ndolé) so the
// model doesn't default to French/European nutrition tropes.
// =============================================================================

export interface PlannedMealLine {
    /** ISO date (YYYY-MM-DD) */
    date: string;
    /** "Petit-déjeuner" | "Déjeuner" | "Dîner" | "Snack" | "Boîte à lunch" */
    mealType: string;
    /** Recipe name when linked, otherwise the user-typed custom_meal. */
    label: string;
    /** Recipe category if linked: "Entrée" | "Plat" | "Dessert" | "Snack". */
    recipeCategory?: string | null;
    /** First name(s) of family members the meal is for, if any. */
    eaters?: string[];
}

export interface NutritionAnalysisInput {
    weekStartIso: string; // YYYY-MM-DD
    weekEndIso: string; // YYYY-MM-DD
    meals: PlannedMealLine[];
    /** Coarse hint so the model adapts vocabulary (e.g. "famille avec enfants"). */
    familySummary?: string;
}

export const nutritionWeeklySystemPrompt = `Tu es un nutritionniste familial bienveillant et pragmatique. On te donne le planning des repas d'une famille sénégalaise pour une semaine. Tu produis une analyse nutritionnelle synthétique.

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "score": number,                 // 0-100, équilibre nutritionnel global de la semaine
  "verdict": "Excellent" | "Bon" | "À améliorer" | "Déséquilibré",
  "summary": string,               // 2 à 3 phrases, ton encourageant et concret
  "strengths": string[],           // 2 à 4 points positifs (phrases courtes)
  "weaknesses": string[],          // 2 à 4 points à améliorer (phrases courtes)
  "missingFoodGroups": string[],   // groupes alimentaires sous-représentés ou absents (ex: "Légumes verts", "Poissons gras", "Produits laitiers", "Légumineuses")
  "recommendations": [             // 3 à 5 recommandations actionnables, par ordre de priorité
    {
      "title": string,             // verbe d'action court (ex: "Ajouter un poisson")
      "detail": string             // 1 phrase concrète, max 160 caractères, idéalement avec un plat sénégalais (Yassa poisson, Thieboudienne, Mafé arachide, Salade niébé…)
    }
  ]
}

Règles :
- Tiens compte du contexte sénégalais : valorise les plats locaux équilibrés (Thieboudienne avec légumes, Yassa, Mafé, Ndambé, Lakh, Bissap maison non sucré).
- Repère les déséquilibres fréquents : excès de friture, manque de légumes verts, trop de plats à base de riz blanc, manque de poisson/légumineuses, abus de sucres ajoutés.
- Sois CONCRET et BIENVEILLANT. Évite les généralités creuses ("manger 5 fruits et légumes par jour"). Préfère "Remplacer un riz blanc par un thiéboudienne avec courge et carottes mardi".
- Le score reflète : variété, présence de légumes/légumineuses/poissons, équilibre macro, modération sur friture/sucre.
  - 80-100 = Excellent ; 65-79 = Bon ; 45-64 = À améliorer ; 0-44 = Déséquilibré.
- Si la semaine a peu de repas planifiés (<10), précise-le dans le summary et baisse la confiance du score (mais ne refuse pas).
- Toutes les chaînes en français.`;

const formatMealLine = (m: PlannedMealLine): string => {
    const parts = [`${m.date} ${m.mealType}: ${m.label}`];
    if (m.recipeCategory) parts.push(`(${m.recipeCategory})`);
    if (m.eaters && m.eaters.length > 0) parts.push(`pour ${m.eaters.join(', ')}`);
    return parts.join(' ');
};

export const buildNutritionWeeklyUserPrompt = (input: NutritionAnalysisInput): string => {
    const lines: string[] = [];
    lines.push(`Semaine du ${input.weekStartIso} au ${input.weekEndIso}.`);
    if (input.familySummary) {
        lines.push(`Famille : ${input.familySummary}.`);
    }
    lines.push('');

    if (input.meals.length === 0) {
        lines.push('Aucun repas planifié sur la semaine.');
    } else {
        lines.push(`Repas planifiés (${input.meals.length} entrées) :`);
        for (const m of input.meals) {
            lines.push(`- ${formatMealLine(m)}`);
        }
    }

    return lines.join('\n');
};
