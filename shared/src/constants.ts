// Shopping List Categories
export const SHOPPING_CATEGORIES = {
    BABY: 'Bébé',
    FOOD: 'Alimentation',
    HOUSEHOLD: 'Ménage',
    HEALTH: 'Santé',
    OTHER: 'Autre',
} as const;

export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[keyof typeof SHOPPING_CATEGORIES];

// Recipe Categories
export const RECIPE_CATEGORIES = {
    STARTER: 'Entrée',
    MAIN: 'Plat',
    DESSERT: 'Dessert',
    SNACK: 'Snack',
} as const;

export type RecipeCategory = (typeof RECIPE_CATEGORIES)[keyof typeof RECIPE_CATEGORIES];

// Budget Categories
export const BUDGET_CATEGORIES = {
    FOOD: 'Alimentation',
    HEALTH: 'Santé',
    CHILDREN: 'Enfants',
    HOUSE: 'Maison',
    LEISURE: 'Loisirs',
    OTHER: 'Autre',
} as const;

export type BudgetCategory = (typeof BUDGET_CATEGORIES)[keyof typeof BUDGET_CATEGORIES];

// Meal Types
export const MEAL_TYPES = {
    BREAKFAST: 'Petit-déjeuner',
    LUNCH: 'Déjeuner',
    DINNER: 'Dîner',
    SNACK: 'Snack',
} as const;

export type MealType = (typeof MEAL_TYPES)[keyof typeof MEAL_TYPES];

// Task Frequencies
export const TASK_FREQUENCIES = {
    DAILY: 'Quotidien',
    WEEKLY: 'Hebdomadaire',
    MONTHLY: 'Mensuel',
    YEARLY: 'Annuel',
    ONCE: 'Une fois',
} as const;

export type TaskFrequency = (typeof TASK_FREQUENCIES)[keyof typeof TASK_FREQUENCIES];

// Days of Week
export const DAYS_OF_WEEK = {
    MONDAY: 'Lundi',
    TUESDAY: 'Mardi',
    WEDNESDAY: 'Mercredi',
    THURSDAY: 'Jeudi',
    FRIDAY: 'Vendredi',
    SATURDAY: 'Samedi',
    SUNDAY: 'Dimanche',
} as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[keyof typeof DAYS_OF_WEEK];

// Recipe Difficulty
export const RECIPE_DIFFICULTY = {
    EASY: 'Facile',
    MEDIUM: 'Moyen',
    HARD: 'Difficile',
} as const;

export type RecipeDifficulty = (typeof RECIPE_DIFFICULTY)[keyof typeof RECIPE_DIFFICULTY];

// Task Priority
export const TASK_PRIORITY = {
    LOW: 'Basse',
    MEDIUM: 'Moyenne',
    HIGH: 'Haute',
} as const;

export type TaskPriority = (typeof TASK_PRIORITY)[keyof typeof TASK_PRIORITY];

// Blood Types
export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export type BloodType = (typeof BLOOD_TYPES)[number];

// Supported currencies for monetary amounts.
// `locale` is used for Intl.NumberFormat; `symbol` is informational.
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

export const SUPPORTED_CURRENCY_CODES = SUPPORTED_CURRENCIES.map((c) => c.code);

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]['code'];

export const DEFAULT_CURRENCY: CurrencyCode = 'EUR';
