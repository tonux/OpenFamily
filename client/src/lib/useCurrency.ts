import { useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, getCurrencySymbol } from './utils';
import { getCurrencyDefinition } from './currencies';

/**
 * Resolves the user's preferred currency and exposes formatters bound to it.
 * Falls back to EUR when the user has not picked one yet.
 */
export function useCurrency() {
    const { user } = useAuth();
    const code = user?.currency ?? null;

    const definition = useMemo(() => getCurrencyDefinition(code), [code]);

    const format = useCallback(
        (amount: number, options?: Intl.NumberFormatOptions) =>
            formatCurrency(amount, code, options),
        [code],
    );

    return {
        code: definition.code,
        symbol: getCurrencySymbol(code),
        name: definition.name,
        locale: definition.locale,
        format,
    };
}
