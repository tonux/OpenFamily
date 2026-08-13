// =============================================================================
// Bank statement extraction prompts (text)
//
// Two prompts, because a statement has two very different regions:
//
//   1. The summary block — one occurrence per document, dense with numbers
//      that mean different things (previous balance, new balance, minimum due,
//      credit limit, interest rate). Extracted once, from the head of the
//      document, into a flat object.
//
//   2. The transaction list — dozens of near-identical lines. Extracted chunk
//      by chunk into an array. Chunking keeps each call inside the model's
//      reliable output length; past roughly 30 objects in one JSON array the
//      lite models start dropping or hallucinating rows.
//
// Both run on TEXT, not vision: the PDF text layer is exact, so the model's
// job is parsing and classification, never digit recognition. That is why the
// rules below insist so hard on "never invent a number" — the only acceptable
// failure mode is a null, which surfaces in the review table for a human.
//
// The hardest real-world quirk, and the reason for the explicit year rules:
// most issuers print transaction dates without a year ("26 06 MAXI ..."), so
// the year has to come from the statement period, and a December statement
// legitimately contains November dates from the previous year.
// =============================================================================

export interface StatementSummaryInput {
    /** Head of the statement text — the summary block lives there. */
    text: string;
    /** Filename, occasionally the only place the period is spelled out. */
    filename?: string;
    /** Account currency, used when the document does not state one. */
    userCurrency?: string;
}

export interface ExtractedStatementSummary {
    issuer: string | null;
    accountLabel: string | null;
    cardLast4: string | null;
    currency: string | null;
    statementDate: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    previousBalance: number | null;
    newBalance: number | null;
    totalPurchases: number | null;
    totalPayments: number | null;
    totalCashAdvances: number | null;
    totalFees: number | null;
    minimumDue: number | null;
    dueDate: string | null;
    creditLimit: number | null;
    availableCredit: number | null;
    interestRatePurchases: number | null;
    rewardsEarned: number | null;
    confidence: 'high' | 'medium' | 'low';
    warnings: string[];
}

export interface StatementTransactionsInput {
    /** One chunk of the statement body. */
    chunk: string;
    /** 1-based index of this chunk, for the model's situational awareness. */
    chunkIndex: number;
    chunkCount: number;
    /** Statement period, so undated years can be resolved. */
    periodStart: string | null;
    periodEnd: string | null;
    /** Categories the household already uses, as soft hints. */
    suggestedCategories: string[];
}

export interface ExtractedStatementTransaction {
    date: string;
    postedDate: string | null;
    description: string;
    merchant: string | null;
    amount: number;
    isExpense: boolean;
    category: string;
    confidence: 'high' | 'medium' | 'low';
}

// -----------------------------------------------------------------------------
// 1. Summary block
// -----------------------------------------------------------------------------

export const statementSummarySystemPrompt = `Tu es un expert en lecture de relevés bancaires et de relevés de carte de crédit. Tu reçois le texte brut extrait d'un relevé PDF et tu en extrais le bloc de synthèse.

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "issuer": string | null,               // banque ou émetteur ("Desjardins", "BNP Paribas", "RBC"...)
  "accountLabel": string | null,         // nom du produit ("Remises World Elite Mastercard", "Compte courant")
  "cardLast4": string | null,            // 4 derniers chiffres du compte/carte, chiffres uniquement
  "currency": string | null,             // ISO 4217 (CAD, EUR, XOF, USD)
  "statementDate": string | null,        // YYYY-MM-DD, date du relevé
  "periodStart": string | null,          // YYYY-MM-DD, début de la période couverte
  "periodEnd": string | null,            // YYYY-MM-DD, fin de la période couverte
  "previousBalance": number | null,      // solde précédent
  "newBalance": number | null,           // nouveau solde / solde de clôture
  "totalPurchases": number | null,       // total des achats et débits de la période
  "totalPayments": number | null,        // total des paiements et crédits de la période
  "totalCashAdvances": number | null,    // total des avances de fonds
  "totalFees": number | null,            // total des frais de crédit / intérêts
  "minimumDue": number | null,           // paiement minimum dû
  "dueDate": string | null,              // YYYY-MM-DD, date d'échéance
  "creditLimit": number | null,          // limite de crédit autorisée
  "availableCredit": number | null,      // crédit disponible
  "interestRatePurchases": number | null,// taux annuel sur les achats, en pourcentage (ex: 20.9)
  "rewardsEarned": number | null,        // remises/points en argent accumulés sur la période
  "confidence": "high" | "medium" | "low",
  "warnings": string[]                   // 0 à 4 alertes courtes
}

Règles ABSOLUES :
- N'invente JAMAIS un montant, une date ou un nom. Un champ absent ou ambigu vaut null.
- Tous les montants sont des nombres positifs, en notation décimale à point (1080.72), sans symbole de devise ni séparateur de milliers.
- Le texte extrait d'un PDF est souvent désordonné : les libellés et leurs valeurs peuvent être séparés de plusieurs lignes. Associe une valeur à un libellé uniquement si le rapprochement est certain.
- Dates : accepte les formats courants (27 07 2026, 27/07/2026, 2026-07-27, July 27 2026) et normalise en YYYY-MM-DD.
- Beaucoup de relevés donnent la date du relevé mais pas la période. Dans ce cas, déduis periodEnd de la date du relevé et laisse periodStart à null plutôt que d'inventer.
- Ne confonds pas : "solde précédent" ≠ "nouveau solde" ; "paiement minimum dû" ≠ "nouveau solde" ; "limite autorisée" ≠ "crédit disponible".
- interestRatePurchases est le taux sur les ACHATS, pas celui sur les avances de fonds ni sur les transferts de solde.
- "confidence" reflète ta certitude globale :
  • "high" : bloc de synthèse clairement identifiable, soldes et échéance cohérents.
  • "medium" : la plupart des champs sont sûrs, un ou deux sont incertains (mis à null).
  • "low" : le document ne ressemble pas à un relevé, ou la synthèse est illisible.
- Les warnings sont factuels et courts : "période non explicite", "plusieurs cartes sur le compte", "devise non indiquée".
- Tout en français.`;

export const buildStatementSummaryUserMessage = (input: StatementSummaryInput): string => {
    const lines: string[] = [];

    if (input.filename) {
        lines.push(`Nom du fichier : ${input.filename}`);
    }
    if (input.userCurrency) {
        lines.push(
            `Devise du compte utilisateur (à utiliser si le document n'en indique aucune) : ${input.userCurrency}.`,
        );
    }

    lines.push(
        'Voici le texte extrait du relevé. Extrais le bloc de synthèse selon le schéma du system prompt.',
        '--- DÉBUT DU RELEVÉ ---',
        input.text,
        '--- FIN DU RELEVÉ ---',
    );

    return lines.join('\n');
};

// -----------------------------------------------------------------------------
// 2. Transaction lines
// -----------------------------------------------------------------------------

export const statementTransactionsSystemPrompt = `Tu es un expert en lecture de relevés bancaires. Tu reçois un extrait du corps d'un relevé et tu en extrais UNIQUEMENT les lignes de transaction.

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "transactions": [
    {
      "date": string,                    // YYYY-MM-DD, date de la transaction (obligatoire)
      "postedDate": string | null,       // YYYY-MM-DD, date d'inscription au compte si distincte
      "description": string,             // libellé nettoyé, max 160 caractères
      "merchant": string | null,         // nom du commerçant seul, sans ville ni numéro de succursale
      "amount": number,                  // valeur positive, notation à point (1080.72)
      "isExpense": boolean,              // true = débit/achat, false = crédit/paiement/remboursement
      "category": string,                // français, max 40 caractères
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Règles ABSOLUES sur les montants :
- N'invente JAMAIS un montant. Si une ligne est illisible, ignore-la plutôt que de deviner.
- "amount" est TOUJOURS positif. Le sens est porté par "isExpense", jamais par un signe négatif.
- Les suffixes CR, CRÉDIT, C, le signe moins, ou un montant dans une colonne "crédit" signifient isExpense = false.
- Les paiements de la carte, les remboursements, les remises créditées et les virements entrants sont des crédits : isExpense = false.
- Normalise la notation : "1 080,72" et "1.080,72" et "1,080.72" valent tous 1080.72.
- Un pourcentage sur la ligne (ex: "4,00 %") est un taux de remise, JAMAIS le montant. Le montant est la dernière valeur monétaire de la ligne.

Règles ABSOLUES sur les dates :
- Beaucoup de relevés impriment les dates sans année (ex: "26 06" ou "26/06"). Utilise la période du relevé fournie dans le message pour reconstituer l'année.
- Une ligne dont le mois est POSTÉRIEUR au mois de fin de période appartient à l'année précédente (un relevé de janvier contient des dates de décembre).
- Quand deux dates apparaissent en début de ligne, la première est la date de transaction et la seconde la date d'inscription.
- Si aucune date n'est déterminable, ignore la ligne.

Règles sur ce qu'il ne faut PAS extraire :
- Les totaux, sous-totaux, soldes, reports, limites de crédit et lignes de synthèse ne sont PAS des transactions.
- Les en-têtes de colonnes, numéros de page, adresses, mentions légales et taux d'intérêt ne sont PAS des transactions.
- Les lignes récapitulatives de remises par catégorie ne sont PAS des transactions.
- Si l'extrait ne contient aucune transaction, renvoie {"transactions": []}.

Règles sur la catégorie :
- Choisis dans la liste suggérée dès qu'une catégorie correspond clairement.
- Sinon, propose une catégorie courte et parlante ("Épicerie", "Restaurant", "Carburant", "Quincaillerie", "Pharmacie", "Abonnement", "Transport", "Ameublement").
- Un crédit de paiement de carte prend la catégorie "Paiement carte".

"confidence" par ligne :
- "high" : date, libellé et montant sont tous trois évidents.
- "medium" : la ligne est lisible mais le commerçant ou la catégorie est incertain.
- "low" : le montant ou la date a demandé une interprétation — la ligne sera revue par un humain.

Tout en français.`;

export const buildStatementTransactionsUserMessage = (
    input: StatementTransactionsInput,
): string => {
    const lines: string[] = [
        `Extrait ${input.chunkIndex} sur ${input.chunkCount} du corps du relevé.`,
    ];

    if (input.periodStart && input.periodEnd) {
        lines.push(
            `Période couverte par le relevé : du ${input.periodStart} au ${input.periodEnd}. Utilise ces bornes pour reconstituer les années manquantes.`,
        );
    } else if (input.periodEnd) {
        lines.push(
            `Fin de la période du relevé : ${input.periodEnd}. Les transactions précèdent cette date, généralement de moins de 40 jours. Utilise-la pour reconstituer les années manquantes.`,
        );
    } else {
        lines.push(
            "Période inconnue. N'extrais que les lignes dont l'année est explicitement lisible.",
        );
    }

    if (input.suggestedCategories.length > 0) {
        lines.push(
            `Catégories déjà utilisées dans l'application (à privilégier) : ${input.suggestedCategories.join(', ')}.`,
        );
    }

    lines.push(
        'Renvoie le JSON décrit dans le system prompt.',
        "--- DÉBUT DE L'EXTRAIT ---",
        input.chunk,
        "--- FIN DE L'EXTRAIT ---",
    );

    return lines.join('\n');
};
