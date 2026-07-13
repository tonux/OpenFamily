// =============================================================================
// Kids activity prompts (dashboard widget, holidays & weekends)
//
// Given tomorrow-or-today's weather, the kids' ages, and a compact digest of
// what the family already has planned, propose screen-free activities that
// give the day a rhythm.
//
// Why short, JSON-strict?
//   Same constraint as clothingPrompts.ts: the default model is an 8B and it
//   tails off badly once the prompt or the expected output gets verbose. Short
//   arrays, short strings, JSON mode enforced provider-side.
//
// Why feed it the family context?
//   This is the whole point of suggesting from inside the app rather than
//   asking a chatbot. The model knows there are tomatoes to water in the
//   garden, a dessert on tonight's meal plan, and swimming at 14:00 — so it
//   suggests things that fit the actual day instead of generic filler.
//
// `category` and `timeOfDay` are stable English slugs, never translated: the
// client maps them to labels through i18n (the project's DATA-vs-UI rule).
// =============================================================================

import type { WeatherSummary } from '../../weather/WeatherService';

export interface ActivityKidInput {
    id: string;
    firstName: string;
    ageYears: number;
}

/** Compact digest of what the app already knows about the target day. */
export interface FamilyDayContext {
    /** e.g. "Natation 14:00-15:00" — slots that are already taken. */
    busySlots: string[];
    /** e.g. "Tomate", "Radis" — plants currently growing. */
    gardenPlants: string[];
    /** e.g. "Dîner : gratin de courgettes" */
    meals: string[];
    /** Chores due that day that a kid could take on. */
    choreTitles: string[];
}

export const ACTIVITY_CATEGORIES = [
    'outdoor',
    'creative',
    'cooking',
    'learning',
    'sport',
    'chores',
    'social',
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const ACTIVITY_TIMES_OF_DAY = ['morning', 'afternoon', 'evening'] as const;
export type ActivityTimeOfDay = (typeof ACTIVITY_TIMES_OF_DAY)[number];

export const kidsActivitiesSystemPrompt = `Tu proposes des activités à des enfants qui sont à la maison (vacances ou week-end).
Ton objectif : occuper la journée SANS AUCUN ÉCRAN (pas de télé, tablette, console, téléphone, YouTube).
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après.
Schéma attendu :
{
  "activities": [
    {
      "kidIds": string[],         // les enfants concernés, ids fournis
      "title": string,            // max 60 caractères, concret et donnant envie
      "category": string,         // outdoor | creative | cooking | learning | sport | chores | social
      "timeOfDay": string,        // morning | afternoon | evening
      "durationMinutes": number,  // entre 15 et 180
      "materials": string[],      // 0 à 5 objets du quotidien
      "instructions": string      // 1 à 2 phrases, max 200 caractères
    }
  ]
}
Règles :
- Propose 3 à 5 activités et rythme la journée : matin actif, après-midi calme et créatif, fin d'après-midi dépense physique.
- Aucune activité sur écran, jamais.
- Adapte à la météo : s'il pleut, s'il vente fort ou s'il fait froid, reste à l'intérieur.
- Adapte à l'âge : plus court et plus guidé pour les petits, plus autonome et plus ambitieux pour les grands.
- Utilise le contexte familial fourni (jardin, repas, corvées) quand il permet une activité concrète.
- Ne chevauche pas les créneaux déjà occupés.
- Matériel du quotidien uniquement, rien à acheter.
- Le champ "kidIds" ne doit contenir que des ids fournis.`;

export const buildKidsActivitiesUserPrompt = (
    weather: WeatherSummary,
    kids: ActivityKidInput[],
    context: FamilyDayContext,
    excludeTitles: string[] = [],
): string => {
    const lines: string[] = [];

    lines.push(
        `Météo du jour : min ${Math.round(weather.tempMin)}°C, max ${Math.round(weather.tempMax)}°C, ${weather.label}, précipitations ${weather.precipBucket}, vent ${weather.windyBucket}.`,
    );

    lines.push('Enfants :');
    for (const kid of kids) {
        lines.push(`- id=${kid.id} prénom=${kid.firstName} age=${kid.ageYears} ans`);
    }

    // Keep the context block tight — every line here is a line the 8B model has
    // to hold on to while producing strict JSON.
    if (context.busySlots.length > 0) {
        lines.push(`Déjà prévu : ${context.busySlots.join(', ')}.`);
    }
    if (context.gardenPlants.length > 0) {
        lines.push(`Au jardin : ${context.gardenPlants.join(', ')}.`);
    }
    if (context.meals.length > 0) {
        lines.push(`Repas prévus : ${context.meals.join(', ')}.`);
    }
    if (context.choreTitles.length > 0) {
        lines.push(`Corvées du jour : ${context.choreTitles.join(', ')}.`);
    }

    if (excludeTitles.length > 0) {
        lines.push(`À ne pas reproposer : ${excludeTitles.join(', ')}.`);
    }

    return lines.join('\n');
};
