// =============================================================================
// Vacation plan prompt — day-by-day itinerary builder
//
// Given a trip (destination, dates, objectives, participants with ages, budget,
// accommodation context) the model returns one structured object per day:
// theme, activities (with cost + duration), meal suggestions, transport notes,
// estimated daily spend. The output mirrors the vacation_itinerary table so
// the route can upsert each day directly.
//
// No PII leaves the server: only first names, ages, and trip metadata. The
// generated content is advisory — the family can edit any day inline.
// =============================================================================

export interface VacationPlanParticipant {
    name: string;
    ageYears: number | null;
}

export interface VacationPlanInput {
    destination: string;
    country: string | null;
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
    days: number;
    objectives: string[];
    /** "airbnb", "chalet", "hotel"… or null when unspecified. */
    accommodationType: string | null;
    /** Total budget for the trip if the family entered one — null otherwise. */
    budgetPlanned: number | null;
    currency: string;
    participants: VacationPlanParticipant[];
    /** Optional free-form notes from the user form ("celiac kid", "no car", …). */
    notes: string | null;
}

export const vacationPlanSystemPrompt = `Tu es un planificateur de voyages familial expérimenté. Tu reçois un séjour (destination, dates, durée, objectifs, participants, budget total) et tu produis un itinéraire jour par jour adapté à toute la famille.

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "summary": string,                       // 1 à 2 phrases présentant l'esprit du séjour, max 280 caractères
  "totalEstimatedCost": number,            // somme cohérente avec les coûts journaliers, dans la devise fournie
  "tips": string[],                        // 2 à 5 conseils transversaux (transports, météo, réservations à anticiper…)
  "days": [
    {
      "dayNumber": number,                 // 1 à N, dans l'ordre chronologique
      "date": "YYYY-MM-DD",                // dérivée de startDate + (dayNumber-1)
      "theme": string,                     // ex: "Arrivée & installation", "Plage & détente", "Visite culturelle", max 50 caractères
      "activities": [
        {
          "title": string,                 // max 80 caractères, à l'impératif ou nominal ("Visiter le Vieux Port")
          "time": "HH:MM" | null,          // créneau suggéré ou null si flexible
          "duration_min": number | null,   // durée estimée en minutes (ou null)
          "cost": number | null,           // coût par famille pour cette activité, dans la devise (ou null si gratuit)
          "location": string | null,       // nom de lieu / quartier
          "notes": string | null           // 1 phrase de conseil (réserver à l'avance, accessible poussette…)
        }
      ],
      "meals_suggestions": [
        {
          "meal": "breakfast" | "lunch" | "dinner" | "snack",
          "suggestion": string,            // ex: "Pique-nique sandwichs locaux", "Restaurant familial pasta"
          "restaurant": string | null,     // nom si une adresse précise est recommandée
          "cost": number | null            // budget famille pour ce repas
        }
      ],
      "estimated_cost": number,            // total du jour (activités + repas + transport), dans la devise
      "transport_notes": string | null,    // ex: "Bus + tram 24h", "Voiture nécessaire", null si à pied
      "notes": string | null               // 1 phrase libre (météo attendue, alternative si pluie…)
    }
  ]
}

Règles ABSOLUES :
- Toujours produire EXACTEMENT \`days\` entrées, une par jour du séjour, dans l'ordre chronologique.
- "date" doit suivre startDate + (dayNumber-1) en YYYY-MM-DD — recalcule à partir des données fournies.
- Tous les montants dans la devise du foyer fournie en input (EUR, XOF, USD…). Ne convertis JAMAIS.
- Adapte les activités à l'âge des participants : enfants < 6 ans = courtes durées + sieste mi-journée ; ados = activités plus actives ; aînés = pauses, accessibilité.
- Respecte les objectifs déclarés : si "détente" → moins de visites, plages/parcs ; "culture" → musées/monuments ; "sport" → randos/activités physiques ; "gastronomie" → restos/marchés locaux. Mixe quand plusieurs objectifs sont présents.
- Le jour 1 = arrivée (souvent activités légères, installation), le dernier jour = départ (activités proches de l'hébergement).
- Si "accommodationType" = camping/chalet → privilégier la nature/randonnée ; si hôtel/airbnb urbain → privilégier visites et restos.
- Le total \`totalEstimatedCost\` doit être cohérent avec la somme des \`estimated_cost\` quotidiens (±5% pour aléas).
- Si "budgetPlanned" est fourni, calibre les activités pour rester dans l'enveloppe (transport + hébergement déjà payés, donc le budget activités+restos vaut typiquement 30-60% du budget total).
- N'invente PAS de lieux qui n'existent pas : si tu n'es pas sûr d'une adresse précise, laisse \`restaurant\` à null et donne plutôt un type d'établissement ("brasserie traditionnelle du centre").
- Tout en français, ton chaleureux mais concis. Pas de superlatifs creux ("incontournable", "magique").`;

const formatAmount = (n: number | null, currency: string): string =>
    n === null ? 'budget non renseigné' : `${n.toFixed(2).replace(/\.00$/, '')} ${currency}`;

const formatParticipant = (p: VacationPlanParticipant): string => {
    if (p.ageYears === null) return p.name;
    return `${p.name} (${p.ageYears} an${p.ageYears > 1 ? 's' : ''})`;
};

export const buildVacationPlanUserPrompt = (input: VacationPlanInput): string => {
    const lines: string[] = [];
    lines.push(`Destination : ${input.destination}${input.country ? `, ${input.country}` : ''}`);
    lines.push(
        `Dates : du ${input.startDate} au ${input.endDate} (${input.days} jour${input.days > 1 ? 's' : ''})`,
    );
    lines.push(`Devise du foyer : ${input.currency}`);
    if (input.accommodationType) {
        lines.push(`Hébergement : ${input.accommodationType}`);
    }
    lines.push(`Budget total prévu : ${formatAmount(input.budgetPlanned, input.currency)}`);
    if (input.objectives.length > 0) {
        lines.push(`Objectifs du séjour : ${input.objectives.join(', ')}`);
    } else {
        lines.push(
            `Objectifs du séjour : non précisés (propose un équilibre détente / découvertes)`,
        );
    }
    if (input.participants.length > 0) {
        lines.push(`Participants : ${input.participants.map(formatParticipant).join(', ')}`);
    } else {
        lines.push(`Participants : non précisés (suppose une famille avec adultes et enfants)`);
    }
    if (input.notes) {
        lines.push(`Notes complémentaires : ${input.notes}`);
    }
    lines.push('');
    lines.push(`Génère l'itinéraire en ${input.days} jour${input.days > 1 ? 's' : ''}.`);
    return lines.join('\n');
};
