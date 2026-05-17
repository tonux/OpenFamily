import { useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePrivacy } from '../contexts/PrivacyContext';
import { formatCurrency, getCurrencySymbol } from './utils';
import { getCurrencyDefinition } from './currencies';

const MASKED_AMOUNT = '••••';

/**
 * Resolves the user's preferred currency and exposes formatters bound to it.
 * Falls back to EUR when the user has not picked one yet.
 * When privacy mode is on, formatted amounts are replaced with a mask so the
 * UI stays usable during demos without revealing financial figures.
 */
export function useCurrency() {
    const { user } = useAuth();
    const { hideAmounts } = usePrivacy();
    const code = user?.currency ?? null;

    const definition = useMemo(() => getCurrencyDefinition(code), [code]);
    const symbol = getCurrencySymbol(code);

    const format = useCallback(
        (amount: number, options?: Intl.NumberFormatOptions) => {
            if (hideAmounts) {
                return `${MASKED_AMOUNT} ${symbol}`;
            }
            return formatCurrency(amount, code, options);
        },
        [code, hideAmounts, symbol],
    );

    return {
        code: definition.code,
        symbol,
        name: definition.name,
        locale: definition.locale,
        format,
        hideAmounts,
    };
}
