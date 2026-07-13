// =============================================================================
// Garden photo scan prompt (vision)
//
// Given a photo of a plant (mode 'plant') or of a whole garden area (mode
// 'zone'), the vision model returns a PROPOSAL to pre-fill the Garden module:
// the zone, the plants, the care tasks to schedule, and a journal observation.
//
// Why this exists:
//   Logging a garden by hand is the reason nobody keeps a garden journal. A
//   photo already contains most of what the module stores — what grows there,
//   whether it looks healthy, and therefore what to do next. The scan turns one
//   tap into a pre-filled, editable form; the user still confirms before
//   anything is written (same human-in-the-loop rule as the receipt scanner).
//
// What the model is trusted with, and what it is NOT:
//   Vision is genuinely good at visible symptoms (yellowing, spots, mildew) and
//   therefore at health_status + the care action to take. It is decent at the
//   plant family. It CANNOT see surface area, soil type, or reliably tell a
//   cultivar apart — those fields are never asked for, so they can't be
//   hallucinated into the form.
//
// Dates are never asked of the model either: it returns `due_in_days` and the
// caller computes planned_date from the server's clock.
//
// The image is NEVER persisted server-side — it lives in memory only for the
// duration of the vision call, then is discarded.
// =============================================================================

import type { ChatContentPart } from '../providers/BaseProvider';

// Enum values are STORED IN FRENCH (DATA-vs-UI rule) — the model must return
// these exact strings. They mirror shared/src/constants.ts; the sanitizers in
// AIService reject anything outside these lists.
export const SCAN_ZONE_TYPES = [
    'Pelouse',
    'Potager',
    'Massif fleuri',
    'Verger',
    'Haie',
    'Autre',
] as const;
export const SCAN_SUN_EXPOSURES = ['Plein soleil', 'Mi-ombre', 'Ombre'] as const;
export const SCAN_PLANT_TYPES = [
    'Légume',
    'Fleur',
    'Arbre',
    'Arbuste',
    'Aromatique',
    'Gazon',
    'Autre',
] as const;
export const SCAN_HEALTH_STATUSES = ['En bonne santé', 'À surveiller', 'Malade', 'Mort'] as const;
export const SCAN_CARE_TYPES = [
    'Arrosage',
    'Tonte',
    'Fertilisation',
    'Taille',
    'Désherbage',
    'Traitement',
    'Inspection',
    'Plantation',
    'Récolte',
] as const;

export type GardenScanMode = 'plant' | 'zone';

export interface GardenScanZoneContext {
    name: string;
    zoneType: string;
    sunExposure?: string | null;
    soilType?: string | null;
}

export interface GardenScanInput {
    /** `data:image/<mime>;base64,<...>` — single photo. */
    imageDataUrl: string;
    mode: GardenScanMode;
    /** 'Printemps' | 'Été' | 'Automne' | 'Hiver' — resolved server-side from the clock. */
    season: string;
    /** Set when the user scans a plant into an existing zone: sharpens the care advice. */
    zoneContext?: GardenScanZoneContext | null;
}

// ---------- Model output shape ----------

export interface ScannedZone {
    name: string;
    zone_type: string;
    sun_exposure: string | null;
    notes: string;
}

export interface ScannedPlant {
    name: string;
    plant_type: string;
    variety: string | null;
    health_status: string;
    watering_frequency_days: number | null;
}

export interface ScannedCare {
    care_type: string;
    title: string;
    /** 0 = today. The caller turns this into planned_date; the model never sees a calendar. */
    due_in_days: number;
    recurrence_days: number | null;
    notes: string | null;
}

export interface ScannedObservation {
    notes: string;
    health_status: string | null;
    height_cm: number | null;
}

export interface GardenScan {
    mode: GardenScanMode;
    /** false when the photo shows nothing identifiable — the UI then offers a retake. */
    detected: boolean;
    confidence: 'high' | 'medium' | 'low';
    /** Only ever populated in 'zone' mode. */
    zone: ScannedZone | null;
    /** Exactly one entry in 'plant' mode; 0..8 in 'zone' mode. */
    plants: ScannedPlant[];
    care: ScannedCare[];
    observation: ScannedObservation | null;
    warnings: string[];
}

// ---------- Prompts ----------

const list = (values: readonly string[]): string => values.map((v) => `"${v}"`).join(' | ');

const COMMON_RULES = `Règles ABSOLUES :
- N'INVENTE RIEN. Si un élément n'est pas visible sur la photo, ne le devine pas : mets null, ou ne le mentionne pas.
- Les valeurs d'énumération doivent être EXACTEMENT l'une des chaînes autorisées, en français, accents inclus. Toute autre valeur sera rejetée.
- Ne propose JAMAIS de surface (m²), de type de sol ni de date : ces informations ne se lisent pas sur une photo.
- "variety" (le cultivar exact, ex : "Coeur de Boeuf") n'est renseigné QUE s'il est certain (étiquette lisible sur la photo). Sinon null.
- "health_status" se déduit de ce qui est VISIBLE : feuillage jaunissant, taches, feuilles trouées, flétrissement, plant sec → "À surveiller" ou "Malade". Un plant vert et vigoureux → "En bonne santé".
- Les actions ("care") découlent de ce que tu observes ET de la saison. Chaque action est un geste CONCRET ("Traiter à la bouillie bordelaise", "Pailler le pied"), jamais une généralité ("prendre soin de la plante").
- "due_in_days" : 0 = aujourd'hui, 7 = dans une semaine. Urgence réelle uniquement — un traitement contre une maladie visible est urgent (0 ou 1), une récolte future ne l'est pas.
- "recurrence_days" : uniquement pour un geste réellement récurrent (arrosage, tonte). null sinon.
- "observation" est le texte du journal de jardin : factuel, descriptif, à l'indicatif ("Taches brunes sur les feuilles basses, suspicion de mildiou"). C'est ce que le jardinier relira dans 3 mois.
- "confidence" : "high" = photo nette, sujet identifiable sans ambiguïté ; "medium" = identification probable mais discutable ; "low" = photo floue/sombre/cadrage trop large.
- Si la photo ne montre aucune plante ni aucun espace vert identifiable, renvoie "detected": false avec des champs vides et explique pourquoi dans "warnings".
- Tout en français, ton accessible à un jardinier débutant.`;

export const gardenPlantScanSystemPrompt = `Tu es un expert en botanique et en jardinage familial. Tu reçois la photo d'UNE plante et tu identifies ce qu'elle est, son état de santé, et les gestes d'entretien à prévoir.

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "detected": boolean,
  "confidence": "high" | "medium" | "low",
  "plant": {
    "name": string,                          // nom commun en français, max 60 car. (ex: "Tomate", "Rosier", "Basilic")
    "plant_type": ${list(SCAN_PLANT_TYPES)},
    "variety": string | null,                // cultivar exact SEULEMENT si une étiquette est lisible. Sinon null.
    "health_status": ${list(SCAN_HEALTH_STATUSES)},
    "watering_frequency_days": number | null // fréquence d'arrosage typique en jours (1 à 30), null si non pertinent
  },
  "observation": {
    "notes": string,                         // entrée de journal, factuelle, max 300 car.
    "health_status": ${list(SCAN_HEALTH_STATUSES)},
    "height_cm": number | null               // hauteur estimée SEULEMENT si un repère d'échelle est visible. Sinon null.
  },
  "care": [                                  // 0 à 3 actions, la plus urgente en premier
    {
      "care_type": ${list(SCAN_CARE_TYPES)},
      "title": string,                       // à l'impératif, max 80 car. (ex: "Traiter à la bouillie bordelaise")
      "due_in_days": number,                 // 0 = aujourd'hui
      "recurrence_days": number | null,
      "notes": string | null                 // le pourquoi, max 200 car.
    }
  ],
  "warnings": string[]                       // 0 à 3 réserves ("photo floue", "identification incertaine entre X et Y"...)
}

${COMMON_RULES}`;

export const gardenZoneScanSystemPrompt = `Tu es un expert en jardinage familial et en aménagement d'espaces verts. Tu reçois la photo d'UN ESPACE de jardin (pelouse, potager, massif, haie…) et tu décris la zone, les plantes que tu y reconnais, et les gestes d'entretien à prévoir.

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "detected": boolean,
  "confidence": "high" | "medium" | "low",
  "zone": {
    "name": string,                          // nom court et descriptif, max 60 car. (ex: "Potager du fond", "Pelouse devant")
    "zone_type": ${list(SCAN_ZONE_TYPES)},
    "sun_exposure": ${list(SCAN_SUN_EXPOSURES)} | null,  // UNIQUEMENT si les ombres portées sur la photo le montrent clairement. Sinon null.
    "notes": string                          // ce que tu observes de l'état général de la zone, max 300 car.
  },
  "plants": [                                // 0 à 8 plantes reconnaissables, les plus visibles d'abord
    {
      "name": string,                        // nom commun en français, max 60 car.
      "plant_type": ${list(SCAN_PLANT_TYPES)},
      "variety": null,                       // toujours null en mode zone : impossible à établir de loin
      "health_status": ${list(SCAN_HEALTH_STATUSES)},
      "watering_frequency_days": number | null
    }
  ],
  "observation": {
    "notes": string,                         // entrée de journal sur l'état de la zone, factuelle, max 300 car.
    "health_status": ${list(SCAN_HEALTH_STATUSES)} | null,
    "height_cm": null
  },
  "care": [                                  // 0 à 4 actions pour la zone, la plus urgente en premier
    {
      "care_type": ${list(SCAN_CARE_TYPES)},
      "title": string,                       // à l'impératif, max 80 car. (ex: "Tondre à 6 cm")
      "due_in_days": number,
      "recurrence_days": number | null,
      "notes": string | null
    }
  ],
  "warnings": string[]
}

Règles supplémentaires pour le mode zone :
- Ne liste QUE les plantes que tu reconnais avec un minimum de certitude. Une liste courte et juste vaut mieux qu'une liste longue et inventée. Zéro plante reconnue est une réponse acceptable.
- Le "zone_type" se déduit de ce qui domine l'image : gazon tondu → "Pelouse" ; rangs de légumes, tuteurs, bacs → "Potager" ; fleurs ornementales groupées → "Massif fleuri" ; arbres fruitiers → "Verger" ; arbustes alignés → "Haie".

${COMMON_RULES}`;

const SEASON_HINT: Record<string, string> = {
    Printemps: 'reprise de végétation, semis, première tonte',
    Été: 'chaleur, arrosage critique, tonte haute',
    Automne: 'ramassage des feuilles, dernières tontes, plantations',
    Hiver: 'repos végétatif, protection contre le gel, taille',
};

export const buildGardenScanUserMessage = (input: GardenScanInput): ChatContentPart[] => {
    const lines: string[] = [];

    lines.push(
        input.mode === 'plant'
            ? "Analyse cette photo de plante : identifie-la, évalue son état de santé, et propose les gestes d'entretien à prévoir."
            : "Analyse cette photo d'un espace de jardin : décris la zone, liste les plantes que tu reconnais, et propose les gestes d'entretien à prévoir.",
    );

    const hint = SEASON_HINT[input.season];
    lines.push(`Saison actuelle : ${input.season}${hint ? ` (${hint})` : ''}.`);

    if (input.zoneContext) {
        const z = input.zoneContext;
        const bits = [`type : ${z.zoneType}`];
        if (z.sunExposure) bits.push(`exposition : ${z.sunExposure}`);
        if (z.soilType) bits.push(`sol : ${z.soilType}`);
        lines.push(`Cette plante se trouve dans la zone « ${z.name} » (${bits.join(', ')}).`);
    }

    lines.push('Renvoie le JSON décrit dans le system prompt.');

    return [
        { type: 'text', text: lines.join('\n') },
        { type: 'image_url', image_url: { url: input.imageDataUrl, detail: 'high' } },
    ];
};

export const gardenScanSystemPrompt = (mode: GardenScanMode): string =>
    mode === 'plant' ? gardenPlantScanSystemPrompt : gardenZoneScanSystemPrompt;
