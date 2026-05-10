// Mirror of shared/src/constants.ts SUPPORTED_CURRENCIES.
// Kept in sync manually because the @openfamily/shared workspace isn't wired in the client bundle.
export interface CurrencyDefinition {
    code: string;
    name: string;
    symbol: string;
    locale: string;
}

export const SUPPORTED_CURRENCIES: readonly CurrencyDefinition[] = [
    { code: 'EUR', name: 'Euro', symbol: '€', locale: 'fr-FR' },
    { code: 'USD', name: 'Dollar US', symbol: '$', locale: 'en-US' },
    { code: 'GBP', name: 'Livre sterling', symbol: '£', locale: 'en-GB' },
    { code: 'CHF', name: 'Franc suisse', symbol: 'CHF', locale: 'fr-CH' },
    { code: 'CAD', name: 'Dollar canadien', symbol: 'C$', locale: 'fr-CA' },
    { code: 'JPY', name: 'Yen japonais', symbol: '¥', locale: 'ja-JP' },
    { code: 'CNY', name: 'Yuan chinois', symbol: '¥', locale: 'zh-CN' },
    { code: 'AUD', name: 'Dollar australien', symbol: 'A$', locale: 'en-AU' },
    { code: 'XOF', name: 'Franc CFA (BCEAO)', symbol: 'CFA', locale: 'fr-SN' },
    { code: 'XAF', name: 'Franc CFA (BEAC)', symbol: 'FCFA', locale: 'fr-CM' },
    { code: 'MAD', name: 'Dirham marocain', symbol: 'DH', locale: 'fr-MA' },
    { code: 'TND', name: 'Dinar tunisien', symbol: 'DT', locale: 'fr-TN' },
    { code: 'DZD', name: 'Dinar algérien', symbol: 'DA', locale: 'fr-DZ' },
    { code: 'BRL', name: 'Réal brésilien', symbol: 'R$', locale: 'pt-BR' },
    { code: 'INR', name: 'Roupie indienne', symbol: '₹', locale: 'en-IN' },
] as const;

export const DEFAULT_CURRENCY = 'EUR';

const CURRENCY_BY_CODE = new Map<string, CurrencyDefinition>(
    SUPPORTED_CURRENCIES.map((c) => [c.code, c])
);

export function getCurrencyDefinition(code: string | null | undefined): CurrencyDefinition {
    if (code) {
        const found = CURRENCY_BY_CODE.get(code);
        if (found) return found;
    }
    return CURRENCY_BY_CODE.get(DEFAULT_CURRENCY)!;
}
