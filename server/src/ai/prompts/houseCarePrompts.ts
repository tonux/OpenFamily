// =============================================================================
// House care prompts — the generative layer of the "Entretien saisonnier"
// module. Three distinct jobs, three prompts:
//
//   1. carePlan       — turn THIS house's profile into a personalised annual
//                       program, on top of the curated catalog.
//   2. weeklyBriefing — the weekly assistant: given the season, the real
//                       forecast and what's late, say what to do this week.
//   3. diagnose       — a symptom ("tache brune au plafond du sous-sol") into
//                       likely causes, urgency, and whether to call a pro.
//
// Design rule shared by all three: the model NEVER writes to the database. The
// plan endpoint returns a proposal the user reviews and accepts, exactly like
// the receipt and garden scanners. A hallucinated maintenance task that
// silently lands in someone's calendar is worse than no suggestion at all.
//
// Second rule, specific to this domain: the model must not play home inspector.
// Anything structural, electrical, gas- or combustion-related is escalated to a
// professional rather than turned into a DIY tutorial. The cost of being wrong
// here isn't a bad recipe suggestion — it's a fire or a collapsed beam.
//
// No PII leaves the server: the profile carries house facts (year, heating,
// basement), never a name or an address. The city is sent only as a climate
// hint when the user has one saved.
// =============================================================================

export interface HouseCareProfileInput {
    dwellingType: string;
    buildYear?: number | null;
    livingAreaM2?: number | null;
    occupants?: number | null;
    climateZone: string;
    city?: string | null;
    hasBasement: boolean;
    basementFinished: boolean;
    hasSumpPump: boolean;
    hasGarage: boolean;
    hasPool: boolean;
    hasSeptic: boolean;
    hasWell: boolean;
    hasIrrigation: boolean;
    hasAirExchanger: boolean;
    heatingTypes: string[];
    roofType?: string | null;
    roofYear?: number | null;
    waterHeaterYear?: number | null;
    windowsYear?: number | null;
    sidingType?: string | null;
    propertyValue?: number | null;
    notes?: string | null;
}

const currentYear = (): number => new Date().getUTCFullYear();

/** Renders the house facts as a compact block shared by all three prompts. */
const describeProfile = (p: HouseCareProfileInput): string[] => {
    const lines: string[] = [];
    const age = p.buildYear
        ? ` (construite en ${p.buildYear}, ${currentYear() - p.buildYear} ans)`
        : '';
    lines.push(`Logement : ${p.dwellingType}${age}.`);
    lines.push(`Climat : ${p.climateZone}${p.city ? `, région de ${p.city}` : ''}.`);
    if (p.livingAreaM2) lines.push(`Superficie habitable : ${p.livingAreaM2} m².`);
    if (p.occupants) lines.push(`Occupants : ${p.occupants}.`);

    const features: string[] = [];
    if (p.hasBasement) features.push(p.basementFinished ? 'sous-sol fini' : 'sous-sol non fini');
    if (p.hasSumpPump) features.push('pompe de puisard');
    if (p.hasGarage) features.push('garage');
    if (p.hasPool) features.push('piscine');
    if (p.hasSeptic) features.push('fosse septique');
    if (p.hasWell) features.push('puits artésien');
    if (p.hasIrrigation) features.push('système d’irrigation');
    if (p.hasAirExchanger) features.push('échangeur d’air (VRC)');
    if (features.length > 0) lines.push(`Caractéristiques : ${features.join(', ')}.`);

    if (p.heatingTypes.length > 0) lines.push(`Chauffage : ${p.heatingTypes.join(' + ')}.`);
    if (p.roofType || p.roofYear) {
        const parts = [p.roofType, p.roofYear ? `posée en ${p.roofYear}` : null].filter(Boolean);
        lines.push(`Toiture : ${parts.join(', ')}.`);
    }
    if (p.waterHeaterYear) lines.push(`Chauffe-eau installé en ${p.waterHeaterYear}.`);
    if (p.windowsYear) lines.push(`Fenêtres de ${p.windowsYear}.`);
    if (p.sidingType) lines.push(`Revêtement extérieur : ${p.sidingType}.`);
    if (p.notes) lines.push(`Notes du propriétaire : ${p.notes}`);
    return lines;
};

// ---------------------------------------------------------------------------
// 1. Annual care plan
// ---------------------------------------------------------------------------

export interface HouseCarePlanInput {
    profile: HouseCareProfileInput;
    /** Titles already in the program — the model must not propose these again. */
    existingTasks: string[];
    /** Inventoried equipment, for tasks the catalog can't know about. */
    equipments: Array<{ name: string; category: string; purchaseYear?: number | null }>;
    season: string;
    /** Free-text goal from the user ("je pars 3 semaines en janvier"). */
    focus?: string | null;
}

export const houseCarePlanSystemPrompt = `Tu es un inspecteur en bâtiment d'expérience qui conseille un PREMIER acheteur. Ton rôle : compléter son programme d'entretien avec ce qui manque VRAIMENT pour sa maison précise, et lui expliquer ce que chaque oubli finit par coûter.

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "summary": string,                  // 2 à 3 phrases : l'état des lieux et LA priorité de cette maison, max 400 caractères
  "tasks": [                          // 4 à 10 tâches ABSENTES du programme actuel
    {
      "title": string,                // max 120 caractères, à l'impératif ("Isoler les tuyaux du vide sanitaire")
      "category": string,             // exactement une de : "Toiture" | "Extérieur" | "Fondation" | "Plomberie" | "Chauffage & ventilation" | "Électricité" | "Sécurité" | "Intérieur" | "Gros postes"
      "season": string,               // exactement une de : "Printemps" | "Été" | "Automne" | "Hiver" | "Toute l'année"
      "frequency": string,            // exactement une de : "Hebdomadaire" | "Mensuel" | "Trimestriel" | "Saisonnier" | "Annuel" | "Pluriannuel"
      "intervalMonths": number|null,  // récurrence en mois (12 = annuel, 24 = aux 2 ans). null si hebdomadaire
      "monthStart": number|null,      // 1-12, début de la fenêtre idéale. null si sans saisonnalité
      "monthEnd": number|null,        // 1-12, fin de la fenêtre. Peut être < monthStart (hiver = 12 à 2)
      "priority": string,             // "Critique" | "Important" | "Confort"
      "responsibility": string,       // "Soi-même" | "Professionnel" | "Mixte"
      "estimatedMinutes": number|null,
      "estimatedCost": number|null,   // coût typique en dollars canadiens si un pro le fait, sinon null
      "riskIfSkipped": string,        // max 300 caractères. CE QUE ÇA COÛTE si on ne le fait pas, avec un ordre de grandeur chiffré
      "steps": string[]               // 2 à 5 étapes concrètes, à l'impératif
    }
  ],
  "priorities": [                     // 2 à 4 actions à faire EN PREMIER, cette saison-ci
    { "title": string, "why": string, "when": string }
  ],
  "budget": {
    "yearlyProvision": number|null,   // montant annuel à mettre de côté, en dollars
    "rationale": string               // max 300 caractères, comment tu arrives à ce montant
  },
  "watchouts": string[]               // 2 à 5 pièges spécifiques à CETTE maison, max 200 caractères chacun
}

Règles ABSOLUES :
- Ne propose JAMAIS une tâche déjà présente dans le programme actuel (la liste t'est fournie). Cherche ce qui MANQUE.
- Adapte à la maison décrite. Pas de tâche de piscine sans piscine, pas de ramonage sans appareil au bois, pas de drain de fondation dans un condo.
- Le climat commande : en climat continental humide, le gel, la fonte, les barrages de glace et la charge de neige dominent le calendrier. En climat doux, ces tâches n'existent pas.
- L'âge commande : une maison de plus de 30 ans mérite des tâches d'inspection (électricité, plomberie, drain) qu'une maison neuve n'a pas besoin.
- "riskIfSkipped" est obligatoire et doit être CONCRET et chiffré en ordre de grandeur. "Ça peut causer des dommages" est inutile. "Un boyau laissé branché fait éclater le tuyau dans le mur : 8 000 à 15 000 $" est utile.
- SÉCURITÉ : tout ce qui touche au gaz, à la combustion, au panneau électrique, à la structure porteuse ou au travail sur un toit est "Professionnel". Ne rédige jamais d'étapes qui font monter quelqu'un sur un toit enneigé ou ouvrir un appareil à combustion.
- Les coûts sont des ORDRES DE GRANDEUR en dollars canadiens, jamais des soumissions. N'invente pas de prix précis.
- Reste dans l'entretien préventif : tu ne diagnostiques pas un problème existant ici, et tu ne remplaces pas une inspection professionnelle.
- Tout en français, ton direct et concret, tutoiement, sans jargon inutile.`;

export const buildHouseCarePlanUserPrompt = (input: HouseCarePlanInput): string => {
    const lines: string[] = [];
    lines.push('LA MAISON');
    lines.push(...describeProfile(input.profile));
    lines.push('');
    lines.push(`Saison actuelle : ${input.season}. Mois : ${new Date().getUTCMonth() + 1}/12.`);

    if (input.equipments.length > 0) {
        lines.push('');
        lines.push('ÉQUIPEMENTS INVENTORIÉS');
        for (const e of input.equipments.slice(0, 25)) {
            const age = e.purchaseYear ? ` — acheté en ${e.purchaseYear}` : '';
            lines.push(`- ${e.name} (${e.category})${age}`);
        }
    }

    lines.push('');
    if (input.existingTasks.length > 0) {
        lines.push(
            `PROGRAMME DÉJÀ EN PLACE (${input.existingTasks.length} tâches) — NE PAS REPROPOSER :`,
        );
        for (const t of input.existingTasks.slice(0, 80)) lines.push(`- ${t}`);
    } else {
        lines.push('PROGRAMME DÉJÀ EN PLACE : aucun. Propose les fondamentaux pour cette maison.');
    }

    if (input.focus) {
        lines.push('');
        lines.push(`CONTEXTE PARTICULIER DU PROPRIÉTAIRE : ${input.focus}`);
    }

    lines.push('');
    lines.push(
        'Complète son programme avec ce qui manque réellement pour CETTE maison, et dis-lui par quoi commencer cette saison.',
    );
    return lines.join('\n');
};

// ---------------------------------------------------------------------------
// 2. Weekly briefing — the assistant voice of the module
// ---------------------------------------------------------------------------

export interface WeeklyBriefingTaskInput {
    title: string;
    category: string;
    priority: string;
    dueOn?: string | null;
    daysLate?: number | null;
    riskIfSkipped?: string | null;
}

export interface WeeklyBriefingInput {
    profile: HouseCareProfileInput;
    season: string;
    todayIso: string;
    /** 7-day outlook, when the user has a city saved. */
    forecast: Array<{
        date: string;
        tempMin: number;
        tempMax: number;
        precipitationMm: number;
        label: string;
        windSpeedMax: number;
    }>;
    weeklyChecklist: Array<{ title: string; doneThisWeek: boolean }>;
    overdue: WeeklyBriefingTaskInput[];
    dueSoon: WeeklyBriefingTaskInput[];
    recentIssues: Array<{ taskTitle: string; doneOn: string; observation?: string | null }>;
}

export const houseWeeklyBriefingSystemPrompt = `Tu es l'assistant d'entretien d'un propriétaire de maison. Chaque semaine, tu lui dis en trente secondes de lecture ce qui compte VRAIMENT pour sa maison cette semaine-ci, en tenant compte de la saison, de la météo annoncée et de ce qui traîne.

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "headline": string,                 // 1 phrase, l'essentiel de la semaine, max 140 caractères
  "summary": string,                  // 2 à 3 phrases de contexte, max 400 caractères
  "focus": [                          // 1 à 4 actions à faire CETTE SEMAINE, la plus urgente en premier
    {
      "title": string,                // max 100 caractères, à l'impératif
      "why": string,                  // max 220 caractères — pourquoi cette semaine précisément
      "when": string,                 // max 60 caractères ("avant jeudi", "samedi matin", "dès aujourd'hui")
      "minutes": number|null
    }
  ],
  "quickChecks": [                    // 2 à 5 vérifications de moins de 5 minutes chacune
    { "label": string, "detail": string }
  ],
  "weatherAlerts": [                  // 0 à 3 alertes DÉDUITES de la météo fournie. Tableau vide si rien à signaler
    { "level": string, "message": string }   // level : "info" | "attention" | "urgent"
  ],
  "encouragement": string             // 1 phrase courte et concrète, max 160 caractères
}

Règles ABSOLUES :
- Base-toi sur les DONNÉES fournies : la météo réelle, les tâches en retard, les problèmes récemment notés. N'invente aucun chiffre météo.
- La météo doit déclencher des conseils concrets quand elle le justifie : un gel annoncé impose de débrancher les boyaux ; 30 mm de pluie imposent de tester la pompe de puisard et de vérifier les gouttières ; un redoux après une bordée impose de surveiller le sous-sol et les barrages de glace ; une canicule impose de vérifier le drain de condensat. S'il n'y a rien de notable, laisse "weatherAlerts" vide plutôt que d'inventer.
- Priorise le RETARD CRITIQUE avant le confort. Une tâche critique en retard passe toujours avant une suggestion saisonnière.
- Si un problème a été noté récemment, reviens dessus : demande où ça en est.
- Ne répète pas les vérifications hebdomadaires déjà cochées cette semaine.
- Sois SPÉCIFIQUE et bref. Pas de généralités du type "prenez soin de votre maison". Chaque ligne doit être actionnable aujourd'hui ou dans les jours qui viennent.
- SÉCURITÉ : ne fais jamais monter quelqu'un sur un toit, sur une échelle en conditions de glace, ni ouvrir un appareil à combustion. Renvoie vers un professionnel.
- Tout en français, tutoiement, ton d'un ami compétent — jamais alarmiste, jamais culpabilisant.`;

export const buildWeeklyBriefingUserPrompt = (input: WeeklyBriefingInput): string => {
    const lines: string[] = [];
    lines.push(`Date : ${input.todayIso}. Saison : ${input.season}.`);
    lines.push('');
    lines.push('LA MAISON');
    lines.push(...describeProfile(input.profile));

    lines.push('');
    if (input.forecast.length > 0) {
        lines.push('MÉTÉO DES 7 PROCHAINS JOURS');
        for (const d of input.forecast) {
            lines.push(
                `- ${d.date} : ${d.label}, ${Math.round(d.tempMin)} à ${Math.round(d.tempMax)} °C, ` +
                    `${d.precipitationMm.toFixed(1)} mm, vent max ${Math.round(d.windSpeedMax)} km/h`,
            );
        }
    } else {
        lines.push('MÉTÉO : non disponible (aucune ville configurée) — ne mentionne pas la météo.');
    }

    lines.push('');
    if (input.overdue.length > 0) {
        lines.push('EN RETARD');
        for (const t of input.overdue.slice(0, 12)) {
            const late = t.daysLate != null ? ` — ${t.daysLate} jours de retard` : '';
            lines.push(`- [${t.priority}] ${t.title} (${t.category})${late}`);
            if (t.riskIfSkipped) lines.push(`  risque : ${t.riskIfSkipped.slice(0, 200)}`);
        }
    } else {
        lines.push('EN RETARD : rien. Le programme est à jour.');
    }

    lines.push('');
    if (input.dueSoon.length > 0) {
        lines.push('À VENIR (30 prochains jours)');
        for (const t of input.dueSoon.slice(0, 12)) {
            lines.push(`- [${t.priority}] ${t.title} (${t.category}) — prévu le ${t.dueOn}`);
        }
    }

    lines.push('');
    if (input.weeklyChecklist.length > 0) {
        lines.push('TOUR HEBDOMADAIRE DE CETTE SEMAINE');
        for (const c of input.weeklyChecklist) {
            lines.push(`- ${c.doneThisWeek ? '[fait]' : '[à faire]'} ${c.title}`);
        }
    }

    if (input.recentIssues.length > 0) {
        lines.push('');
        lines.push('PROBLÈMES NOTÉS RÉCEMMENT');
        for (const i of input.recentIssues) {
            lines.push(
                `- ${i.doneOn} — ${i.taskTitle}${i.observation ? ` : ${i.observation.slice(0, 200)}` : ''}`,
            );
        }
    }

    lines.push('');
    lines.push('Rédige le briefing de la semaine.');
    return lines.join('\n');
};

// ---------------------------------------------------------------------------
// 3. Symptom diagnosis
// ---------------------------------------------------------------------------

export interface HouseDiagnoseInput {
    profile: HouseCareProfileInput;
    symptom: string;
    location?: string | null;
    since?: string | null;
    season: string;
}

export const houseDiagnoseSystemPrompt = `Tu es un inspecteur en bâtiment qui aide un propriétaire à comprendre un symptôme dans sa maison. Tu ne remplaces PAS une inspection sur place : tu l'aides à savoir si c'est urgent, ce que ça peut être, et s'il doit appeler quelqu'un.

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "summary": string,                  // 2 à 3 phrases : ce que ça évoque et le degré de sérieux, max 400 caractères
  "urgency": string,                  // "Immédiat" | "Cette semaine" | "À surveiller"
  "urgencyReason": string,            // max 200 caractères, pourquoi ce niveau
  "likelyCauses": [                   // 2 à 5 causes, de la plus probable à la moins probable
    {
      "cause": string,                // max 100 caractères
      "likelihood": string,           // "Probable" | "Possible" | "Moins probable"
      "explanation": string,          // max 250 caractères — pourquoi c'est cohérent avec le symptôme décrit
      "howToConfirm": string          // max 200 caractères — le test SANS RISQUE que le propriétaire peut faire
    }
  ],
  "immediateActions": string[],       // 1 à 4 gestes à poser tout de suite, sans risque, max 200 caractères chacun
  "callAPro": boolean,                // true si un professionnel est nécessaire
  "proType": string|null,             // "plombier" | "couvreur" | "maître électricien" | "technicien en réfrigération" | "ingénieur en structure" | "inspecteur en bâtiment" | …
  "questionsForPro": string[],        // 2 à 4 questions à poser pour ne pas se faire vendre n'importe quoi
  "estimatedCostRange": string|null,  // ordre de grandeur en dollars canadiens, ex. "300 à 1 500 $ selon la cause"
  "redFlags": string[],               // 0 à 4 signes qui, s'ils apparaissent, imposent d'agir immédiatement
  "preventiveTasks": string[]         // 0 à 3 tâches d'entretien à ajouter au programme pour que ça ne revienne pas
}

Règles ABSOLUES :
- SÉCURITÉ D'ABORD. Odeur de gaz, odeur de brûlé électrique, monoxyde de carbone, affaissement structural, eau en contact avec l'électricité : urgency = "Immédiat", callAPro = true, et les immediateActions commencent par évacuer / couper / appeler le service d'urgence approprié. Aucune manipulation de bricolage dans ces cas.
- Ne demande JAMAIS au propriétaire de monter sur un toit, d'ouvrir un panneau électrique, de démonter un appareil à combustion ou d'intervenir sur le gaz.
- "howToConfirm" doit être un test réellement sans danger et réalisable par un non-spécialiste.
- Dis clairement quand tu ne peux pas trancher à distance. Un diagnostic honnête et incertain vaut mieux qu'une fausse certitude.
- Les coûts sont des ORDRES DE GRANDEUR en dollars canadiens, jamais des soumissions.
- Tiens compte de la maison décrite et de la saison : une tache au plafond du sous-sol en mars évoque la fonte ; la même en juillet évoque une fuite de plomberie.
- Tout en français, tutoiement, ton calme et factuel. Ne dramatise pas, ne minimise pas.`;

export const buildHouseDiagnoseUserPrompt = (input: HouseDiagnoseInput): string => {
    const lines: string[] = [];
    lines.push('LA MAISON');
    lines.push(...describeProfile(input.profile));
    lines.push('');
    lines.push(`Saison actuelle : ${input.season}.`);
    lines.push('');
    lines.push('LE SYMPTÔME');
    lines.push(input.symptom);
    if (input.location) lines.push(`Où : ${input.location}.`);
    if (input.since) lines.push(`Depuis : ${input.since}.`);
    lines.push('');
    lines.push('Aide-le à comprendre ce que c’est, si c’est urgent, et quoi faire maintenant.');
    return lines.join('\n');
};
