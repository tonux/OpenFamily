// =============================================================================
// Color presets — palette "Famille Sénégalaise" (indigo + safran + baobab).
//
// Inspired by the mascot illustration (public/images/family.png).
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
    'rgb(var(--primary))', // indigo Papa
    'rgb(var(--accent))', // safran
    'rgb(var(--success))', // vert baobab
    'rgb(var(--info))', // turquoise (Fille)
    'rgb(var(--warning))', // jaune soleil
    'rgb(var(--destructive))', // corail brique
];

// Default for newly-created family members (matches the new primary indigo).
export const DEFAULT_FAMILY_COLOR = '#2D4A78';

// Color picker for family members & rooms. 9 distinct tones tied to the
// "Famille Sénégalaise" mood — indigo, safran, baobab, turquoise, soleil,
// corail, magenta, or lion, terre baobab.
export const FAMILY_COLOR_PRESETS = [
    { value: '#2D4A78', label: 'Indigo' },
    { value: '#E8943C', label: 'Safran' },
    { value: '#5C8A4B', label: 'Baobab' },
    { value: '#4A9B8E', label: 'Turquoise' },
    { value: '#F4C430', label: 'Soleil' },
    { value: '#C0392B', label: 'Corail' },
    { value: '#C44569', label: 'Magenta' },
    { value: '#D4A24C', label: 'Or lion' },
    { value: '#8B5A3C', label: 'Terre' },
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
    'Petit-déjeuner': { from: '#FEF4D2', to: '#FCE9B0', border: '#F4C430' }, // soleil
    Déjeuner: { from: '#E8EEF7', to: '#D2DEEF', border: '#2D4A78' }, // indigo
    Dîner: { from: '#FCEFE1', to: '#F8DDC0', border: '#E8943C' }, // safran
    Snack: { from: '#E8F0E2', to: '#D5E5C9', border: '#5C8A4B' }, // baobab
    'Boîte à lunch': { from: '#FAE2DE', to: '#F5C9C2', border: '#C0392B' }, // corail
};

export const mealTypeGradient = (mealType: string): React.CSSProperties => {
    const palette = MEAL_TYPE_COLORS[mealType] ?? {
        from: '#F8F1E4',
        to: '#EFE5D0',
        border: '#D1C0A2',
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
