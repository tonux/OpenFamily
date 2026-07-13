// =============================================================================
// Clothing prompts (dashboard widget)
//
// One short, JSON-only prompt for the 8B default model. Given tomorrow's
// weather summary and the kids' ages, suggest a small wardrobe per kid.
//
// Why short, JSON-strict?
//   8B models tail off badly once the prompt or expected output gets
//   verbose. We constrain to short arrays of short strings and demand JSON
//   mode at the provider side. The client renders pills directly from the
//   arrays — no further parsing needed.
//
// The category labels (top/bottom/footwear/accessories) match the widget
// section headers verbatim, so the model's choice of bucket maps 1:1 onto
// what the user sees.
// =============================================================================

import type { WeatherSummary } from '../../weather/WeatherService';

export interface ClothingKidInput {
    id: string;
    firstName: string;
    ageYears: number;
}

/**
 * Whether the kid spends the day at school or at home. Drives the first line of
 * the system prompt: a school outfit and a holiday outfit are not the same
 * brief (one has a dress code and a playground, the other has a garden, a park
 * and mud).
 */
export type ClothingDayMode = 'school' | 'home';

const DAY_MODE_INTRO: Record<ClothingDayMode, string> = {
    school: "Tu suggères une tenue pour un enfant qui va à l'école, en fonction de la météo et de son âge.",
    home: 'Tu suggères une tenue pour un enfant qui passe la journée à la maison et dehors (vacances ou week-end) : il va jouer, bouger et se salir. Privilégie le confort et les vêtements qui ne craignent rien.',
};

export const buildClothingSystemPrompt = (mode: ClothingDayMode): string =>
    `${DAY_MODE_INTRO[mode]}
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après.
Schéma attendu :
{
  "suggestions": [
    {
      "kidId": string,
      "top": string[],            // 1 à 3 articles, ex. "T-shirt manches longues"
      "bottom": string[],         // 1 à 2 articles, ex. "Pantalon en jean"
      "footwear": string[],       // 1 article, ex. "Bottes imperméables"
      "accessories": string[],    // 0 à 3 articles, ex. "Bonnet", "Écharpe", "Gants"
      "advice": string            // une phrase brève (max 140 caractères)
    }
  ]
}
Règles :
- Adapte selon l'âge (vêtements plus chauds et plus simples pour les jeunes enfants).
- Tiens compte de la pluie, du vent et de la température minimale.
- Articles courts en français, sans marque, sans quantité, sans couleur.
- Une suggestion par enfant, dans l'ordre exact fourni.
- Le champ "kidId" doit reprendre la valeur fournie pour chaque enfant.`;

/** Kept for callers that still assume a school day. */
export const clothingSuggestionsSystemPrompt = buildClothingSystemPrompt('school');

export const buildClothingUserPrompt = (
    weather: WeatherSummary,
    kids: ClothingKidInput[],
): string => {
    const lines: string[] = [];
    lines.push(
        `Météo : min ${Math.round(weather.tempMin)}°C, max ${Math.round(weather.tempMax)}°C, ${weather.label}, précipitations ${weather.precipBucket}, vent ${weather.windyBucket}.`,
    );
    lines.push('Enfants :');
    for (const kid of kids) {
        lines.push(`- id=${kid.id} prénom=${kid.firstName} age=${kid.ageYears} ans`);
    }
    return lines.join('\n');
};
