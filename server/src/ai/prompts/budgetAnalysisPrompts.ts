// =============================================================================
// Budget analysis prompt (financial coaching)
//
// Given the family's current month — totals, category breakdown, per-member
// spending, monthly limits — plus a 3-month trend, the model returns a
// structured analysis: score, verdict, strengths/weaknesses, savings
// opportunities, prioritised recommendations, and immediate alerts.
//
// Why this exists:
//   The Budget page already crunches the numbers and shows charts, but a
//   parent who scans those charts has to do the interpretation work
//   ("are loisirs too high?", "should I cut alimentation?"). The AI takes
//   that cognitive step and turns it into concrete next actions, in the
//   user's currency, with member-aware advice.
//
// No PII leaves the server: only first names, category labels and amounts.
// =============================================================================

export interface BudgetMonthSnapshot {
    month: number; // 1..12
    year: number;
    currency: string;
    totalExpenses: number;
    totalIncome: number;
    balance: number;
    byCategory: Array<{ category: string; amount: number; limit: number | null }>;
    byMember: Array<{ memberName: string; category: string; amount: number }>;
    topEntries: Array<{
        date: string; // YYYY-MM-DD
        category: string;
        amount: number;
        description: string | null;
        memberName: string | null;
    }>;
}

export interface BudgetTrendPoint {
    month: number; // 1..12
    year: number;
    totalExpenses: number;
    totalIncome: number;
}

export interface BudgetAnalysisInput {
    snapshot: BudgetMonthSnapshot;
    /** Up to 3 historical months ordered oldest → newest (excluding the snapshot month). */
    trend: BudgetTrendPoint[];
    /** Light family context (kids count, member count) so advice is age-aware. */
    familySummary?: string;
}

export const budgetAnalysisSystemPrompt = `Tu es un conseiller financier familial bienveillant. Tu analyses le budget mensuel d'un foyer et tu produis un diagnostic concret + des recommandations actionnables.

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "score": number,                   // 0 à 100 — santé financière globale (100 = excellente)
  "verdict": "Excellent" | "Sain" | "À surveiller" | "Critique",
  "summary": string,                 // 1 à 2 phrases — diagnostic d'ensemble, max 280 caractères
  "strengths": string[],             // 1 à 4 points positifs ("Solde positif de X", "Aucune catégorie dépassée"…)
  "weaknesses": string[],            // 1 à 4 points d'attention ("Loisirs +40% vs moyenne", "Limite Alimentation dépassée de 60€"…)
  "savingsOpportunities": [          // 0 à 4 pistes d'économie concrètes, montant estimé dans la devise du foyer
    {
      "category": string,
      "estimatedAmount": number,     // > 0, dans la devise du foyer
      "how": string                  // une phrase concrète ("Cuisiner 2 repas de plus à la maison", "Annuler l'abonnement X"…)
    }
  ],
  "recommendations": [               // 2 à 5 actions priorisées
    {
      "title": string,               // max 60 caractères, à l'impératif ("Réduire les sorties restaurant")
      "detail": string               // max 220 caractères, explication concrète
    }
  ],
  "alerts": string[]                 // 0 à 3 urgences ("Solde négatif", "Limite santé dépassée", "Dépense atypique de X le JJ/MM")
}

Règles ABSOLUES :
- Tous les montants dans la devise du foyer fournie en input — utilise le code (EUR, XOF, USD…) si tu cites un chiffre. Ne convertis JAMAIS.
- N'invente PAS de chiffres : appuie-toi uniquement sur les données fournies (snapshot + tendance). Si un point manque, ne l'évoque pas.
- "score" reflète l'équilibre global :
  • 80-100 : revenus > dépenses confortablement, aucune catégorie dépassée, tendance stable ou en amélioration.
  • 60-79  : équilibre correct, quelques cat. proches de la limite ou tendance à surveiller.
  • 40-59  : déficit léger ou dépassement net d'une cat. importante, à corriger.
  • 0-39   : déficit marqué, multiples cat. en dépassement, anomalies majeures.
- "verdict" doit cohérer avec score (Excellent ≥ 80, Sain 60-79, À surveiller 40-59, Critique < 40).
- Les "alerts" sont réservées aux signaux IMMÉDIATS : solde négatif, limite dépassée, dépense aberrante. N'utilise pas alerts comme synonyme de weaknesses.
- "savingsOpportunities" doit être concret : pas "économisez sur l'alimentation", mais "préparer 3 dîners au lieu de commander" avec un montant plausible.
- "recommendations" priorise par impact : la première = celle qui change le plus la trajectoire.
- Tiens compte de la tendance 3 mois : si une catégorie augmente régulièrement, mentionne-le. Si le foyer s'améliore, dis-le dans strengths.
- Tout en français, concret, sans condescendance — la famille connaît son budget mieux que toi, tu apportes une vue de synthèse.`;

const formatAmount = (n: number, currency: string): string =>
    `${n.toFixed(2).replace(/\.00$/, '')} ${currency}`;

const MONTH_LABEL = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
];

const monthLabel = (m: number, y: number): string => `${MONTH_LABEL[m - 1] ?? m} ${y}`;

export const buildBudgetAnalysisUserPrompt = (input: BudgetAnalysisInput): string => {
    const lines: string[] = [];
    const s = input.snapshot;
    const cur = s.currency || 'EUR';

    lines.push(`Mois analysé : ${monthLabel(s.month, s.year)} (devise du foyer : ${cur}).`);
    if (input.familySummary) {
        lines.push(`Composition : ${input.familySummary}.`);
    }

    lines.push('');
    lines.push('Totaux du mois :');
    lines.push(`- Revenus : ${formatAmount(s.totalIncome, cur)}`);
    lines.push(`- Dépenses : ${formatAmount(s.totalExpenses, cur)}`);
    lines.push(`- Solde : ${formatAmount(s.balance, cur)}`);

    if (s.byCategory.length > 0) {
        lines.push('');
        lines.push('Dépenses par catégorie (avec limite mensuelle si définie) :');
        for (const c of s.byCategory) {
            const limitStr =
                c.limit !== null ? `limite ${formatAmount(c.limit, cur)}` : 'pas de limite';
            const over =
                c.limit !== null && c.amount > c.limit
                    ? ` — DÉPASSÉE de ${formatAmount(c.amount - c.limit, cur)}`
                    : '';
            lines.push(`- ${c.category} : ${formatAmount(c.amount, cur)} (${limitStr})${over}`);
        }
    }

    if (s.byMember.length > 0) {
        lines.push('');
        lines.push('Dépenses par membre × catégorie :');
        for (const m of s.byMember) {
            lines.push(`- ${m.memberName} / ${m.category} : ${formatAmount(m.amount, cur)}`);
        }
    }

    if (s.topEntries.length > 0) {
        lines.push('');
        lines.push('Plus grosses transactions du mois (pour repérer les éventuelles anomalies) :');
        for (const e of s.topEntries) {
            const memberPart = e.memberName ? ` — ${e.memberName}` : '';
            const descPart = e.description ? ` — "${e.description}"` : '';
            lines.push(
                `- ${e.date} / ${e.category} / ${formatAmount(e.amount, cur)}${memberPart}${descPart}`,
            );
        }
    }

    if (input.trend.length > 0) {
        lines.push('');
        lines.push('Tendance des 3 mois précédents (du plus ancien au plus récent) :');
        for (const t of input.trend) {
            lines.push(
                `- ${monthLabel(t.month, t.year)} : dépenses ${formatAmount(t.totalExpenses, cur)}, revenus ${formatAmount(t.totalIncome, cur)}, solde ${formatAmount(t.totalIncome - t.totalExpenses, cur)}`,
            );
        }
    }

    return lines.join('\n');
};
