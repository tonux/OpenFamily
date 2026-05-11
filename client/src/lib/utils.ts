import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

export function formatTime(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
    });
}

import { getCurrencyDefinition } from './currencies';

export function formatCurrency(
    amount: number,
    currencyCode?: string | null,
    options?: Intl.NumberFormatOptions,
): string {
    const def = getCurrencyDefinition(currencyCode);
    return new Intl.NumberFormat(def.locale, {
        style: 'currency',
        currency: def.code,
        ...options,
    }).format(amount);
}

export function getCurrencySymbol(currencyCode?: string | null): string {
    return getCurrencyDefinition(currencyCode).symbol;
}
