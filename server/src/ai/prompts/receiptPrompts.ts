// =============================================================================
// Receipt extraction prompt (vision)
//
// Given a photo of a receipt / facture, the vision model extracts the fields
// needed to pre-fill the Budget "Nouvelle entrée" dialog: total amount, date,
// merchant, suggested category, short description. The image goes in as an
// inline base64 data URL inside an OpenAI-compatible content array.
//
// Why this exists:
//   Parents often have a pile of physical receipts to log. Manual entry is
//   tedious; a one-tap "scan" that pre-fills the form removes the friction
//   while keeping a human-in-the-loop confirmation step (no autosave).
//
// The image is NEVER persisted server-side — it lives in memory only for the
// duration of the vision call, then is discarded.
// =============================================================================

import type { ChatContentPart } from '../providers/BaseProvider';

export interface ReceiptExtractionInput {
    /** `data:image/<mime>;base64,<...>` — single image, the photo of the receipt. */
    imageDataUrl: string;
    /** Categories the user already uses, presented as soft hints to the model. */
    suggestedCategories: string[];
    /** ISO 4217 currency of the user account, for amount disambiguation. */
    userCurrency?: string;
}

export interface ExtractedReceipt {
    amount: number | null;
    currency: string | null;
    date: string | null;
    merchant: string | null;
    category: string;
    description: string;
    confidence: 'high' | 'medium' | 'low';
    warnings: string[];
}

export const receiptExtractionSystemPrompt = `Tu es un expert en lecture de tickets de caisse, factures et reçus. Tu reçois une photo et tu extrais les informations utiles pour enregistrer une dépense.

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "amount": number | null,         // total TTC en valeur numérique positive (ex: 24.50). null si illisible.
  "currency": string | null,       // code ISO 4217 si visible (EUR, XOF, USD, CAD...). null si invisible.
  "date": string | null,           // YYYY-MM-DD si visible. null sinon. N'invente jamais une date.
  "merchant": string | null,       // nom du commerçant (ex: "Auchan", "Pharmacie Diop"). null si absent.
  "category": string,              // libre, en français, max 50 caractères. Privilégie la liste suggérée.
  "description": string,           // une phrase courte, max 120 caractères (ex: "Courses Auchan, 12 articles").
  "confidence": "high" | "medium" | "low",
  "warnings": string[]             // 0 à 3 alertes ("image floue", "monnaie non reconnue", "plusieurs totaux visibles"...)
}

Règles ABSOLUES :
- N'invente JAMAIS un chiffre. Si le montant total n'est pas lisible avec certitude, mets "amount": null et "confidence": "low".
- Le montant est TOUJOURS le total TTC (toutes taxes comprises), pas un sous-total HT ni un montant de TVA.
- Pour la date, accepte les formats FR/EN courants (12/03/2025, 2025-03-12, March 12 2025) et normalise en YYYY-MM-DD.
- Si plusieurs montants sont visibles (sous-total, TVA, total), choisis le total final et signale les autres dans warnings.
- Pour la catégorie, choisis dans la liste suggérée si une correspond clairement. Sinon, propose une catégorie pertinente courte ("Carburant", "Restaurant", "Pharmacie", "Transport"...).
- "confidence" reflète ta certitude globale :
  • "high" : image nette, total clair, marchand et date visibles.
  • "medium" : un ou deux champs ambigus mais le total est sûr.
  • "low" : image floue/coupée, total incertain — utilise null sur les champs non sûrs.
- Tout en français, concis et factuel.`;

export const buildReceiptExtractionUserMessage = (
    input: ReceiptExtractionInput,
): ChatContentPart[] => {
    const lines: string[] = [
        'Extrais les informations utiles de cette facture / ticket de caisse pour créer une entrée de dépense.',
    ];

    if (input.userCurrency) {
        lines.push(`Devise du compte utilisateur : ${input.userCurrency}.`);
    }

    if (input.suggestedCategories.length > 0) {
        lines.push(
            `Catégories déjà utilisées dans l'application (à privilégier si pertinent) : ${input.suggestedCategories.join(', ')}.`,
        );
    } else {
        lines.push('Aucune catégorie pré-existante — propose une catégorie courte et pertinente.');
    }

    lines.push('Renvoie le JSON décrit dans le system prompt.');

    return [
        { type: 'text', text: lines.join('\n') },
        { type: 'image_url', image_url: { url: input.imageDataUrl, detail: 'high' } },
    ];
};
