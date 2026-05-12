// =============================================================================
// Color presets — palette "Famille pop" (mauve doux + menthe + miel).
//
// Centralises every categorical palette outside of CSS tokens:
//   - CHART_COLOR_PRESETS : recharts series cycle (uses the runtime CSS vars,
//     so dark mode swaps automatically).
//   - FAMILY_COLOR_PRESETS : color picker for family_members + rooms.
//   - MEAL_TYPE_COLORS    : per-meal-type tints used by MealPlanning grid.
//   - PROJECT_STATUS_COLORS : status badges for House / Projets.
//
// When you change a value here, NO other file needs to be touched.
// =============================================================================

import type React from 'react';

export const CHART_COLOR_PRESETS = [
    'rgb(var(--primary))', // mauve
    'rgb(var(--accent))', // menthe
    'rgb(var(--warning))', // miel
    'rgb(var(--info))', // bleuet
    'rgb(var(--destructive))', // corail doux
    'rgb(var(--muted-foreground))',
];

// Default for newly-created family members (matches the new primary).
export const DEFAULT_FAMILY_COLOR = '#8E6FB6';

// Color picker for family members & rooms. 9 distinct tones tied to the
// "Famille pop" mood — mauve, menthe, miel, corail, bleuet + four neighbours.
export const FAMILY_COLOR_PRESETS = [
    { value: '#8E6FB6', label: 'Mauve' },
    { value: '#6FB58F', label: 'Menthe' },
    { value: '#F5C546', label: 'Miel' },
    { value: '#E36571', label: 'Corail' },
    { value: '#6593C2', label: 'Bleuet' },
    { value: '#B399D9', label: 'Lavande' },
    { value: '#F4A28C', label: 'Saumon' },
    { value: '#95B79E', label: 'Sauge' },
    { value: '#D9A05B', label: 'Caramel' },
];

// =============================================================================
// Meal-type tints used by the calendar gradients in MealPlanning.tsx.
// `from` and `to` are hex (suitable for inline CSS gradients via
// `style={{ background: `linear-gradient(...)` }}`); `border` is the hue at
// full saturation for the cell border.
// =============================================================================

export interface MealTypePalette {
    from: string;
    to: string;
    border: string;
}

export const MEAL_TYPE_COLORS: Record<string, MealTypePalette> = {
    'Petit-déjeuner': { from: '#FCF3D2', to: '#FBE6B8', border: '#F5C546' }, // miel
    Déjeuner: { from: '#E1ECF6', to: '#D2E1F0', border: '#6593C2' }, // bleuet
    Dîner: { from: '#F1ECF8', to: '#E8DFF3', border: '#8E6FB6' }, // mauve
    Snack: { from: '#E8F3EC', to: '#D5EBDB', border: '#A4D4AE' }, // menthe
    'Boîte à lunch': { from: '#FBE3E5', to: '#F8D2D6', border: '#E36571' }, // corail
};

export const mealTypeGradient = (mealType: string): React.CSSProperties => {
    const palette = MEAL_TYPE_COLORS[mealType] ?? {
        from: '#F5F3ED',
        to: '#EFEDE5',
        border: '#D6D1C5',
    };
    return {
        background: `linear-gradient(to bottom right, ${palette.from}, ${palette.to})`,
        borderColor: palette.border,
    };
};

// =============================================================================
// Status badges — Tailwind class strings (semantic, dark-mode aware via tokens).
// Project status used in the Projects tab; same shape can be reused if other
// modules introduce status enums (e.g., contracts active/inactive).
// =============================================================================

export interface StatusBadgeColors {
    bg: string;
    text: string;
}

export const PROJECT_STATUS_COLORS: Record<string, StatusBadgeColors> = {
    Idée: { bg: 'bg-surface-2', text: 'text-muted-foreground' },
    'En cours': { bg: 'bg-primary/10', text: 'text-primary' },
    Terminé: { bg: 'bg-success-soft', text: 'text-success' },
    Suspendu: { bg: 'bg-warning-soft', text: 'text-warning' },
};
