// =============================================================================
// Shopping prompts (PR #17)
//
// Two short, JSON-only prompts for the 8B default model:
//   - classifyShoppingItem: one item name → one category
//   - parseShoppingNaturalLanguage: free-form FR sentence → list of items
//
// Why short prompts?
//   8B models struggle once the prompt is verbose; brevity dramatically
//   improves accuracy and cuts cost.  Always demand strict JSON and pair the
//   call with `response_format: json_object` on the provider side.
//
// Categories MUST stay in lockstep with the client (client/src/pages/
// ShoppingList.tsx) and with shopping_items.category column constraints.
// =============================================================================

export const SHOPPING_CATEGORIES = ['Alimentation', 'Bebe', 'Menage', 'Sante', 'Autre'] as const;
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];

const CATEGORY_LIST = SHOPPING_CATEGORIES.map((c) => `"${c}"`).join(', ');

export const classifyShoppingItemSystemPrompt = `Tu classes un article de courses en une seule catégorie en français.
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après.
Schéma attendu :
{"category": ${CATEGORY_LIST.replace(/,/g, ' |')}}
Si tu hésites, choisis "Autre". Tu ne renvoies jamais autre chose que le JSON.`;

export const buildClassifyShoppingItemUserPrompt = (itemName: string): string => itemName;

export const parseShoppingNaturalLanguageSystemPrompt = `Tu convertis une phrase en français en liste d'articles de courses, au format JSON strict.
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après.
Schéma attendu :
{
  "items": [
    {
      "name": string,
      "quantity": number | null,
      "unit": string | null,
      "category": ${CATEGORY_LIST.replace(/,/g, ' |')}
    }
  ]
}
Règles :
- "name" est le nom court de l'article, sans la quantité ni l'unité.
- "quantity" est nullable si la quantité est ambiguë ou absente.
- "unit" est nullable (litre, kg, paquet, sachet…). Ne devine jamais.
- "category" est obligatoire ; "Autre" en cas de doute.
- Ne renvoie jamais de tableau vide si la phrase contient au moins un article.`;

export const buildParseShoppingNLUserPrompt = (text: string): string => text;
