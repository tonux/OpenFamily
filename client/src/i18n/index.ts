// =============================================================================
// i18n bootstrap
//
// KeurTonux is built FR-first but distributed as open source — the strings
// in components hardcoded in French need to migrate to translation keys so
// non-FR forks become possible without a fork-and-replace exercise.
//
// This module is imported once from main.tsx and self-initializes. Adding a
// new language is a matter of dropping a JSON file under ./locales/<code>/
// and listing it in SUPPORTED_LANGUAGES below.
// =============================================================================
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import fr from './locales/fr/common.json';
import en from './locales/en/common.json';

export const SUPPORTED_LANGUAGES = ['fr', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            fr: { common: fr },
            en: { common: en },
        },
        fallbackLng: 'fr',
        defaultNS: 'common',
        supportedLngs: SUPPORTED_LANGUAGES,
        nonExplicitSupportedLngs: true, // map 'fr-FR' -> 'fr', 'en-US' -> 'en'
        interpolation: {
            // React already escapes; double-escaping breaks accented strings.
            escapeValue: false,
        },
        detection: {
            // Persist user choice in localStorage so navigation across reloads
            // keeps the same language.
            order: ['localStorage', 'navigator'],
            lookupLocalStorage: 'openfamily.language',
            caches: ['localStorage'],
        },
        // FR has all keys; missing keys in other languages fall back silently.
        returnNull: false,
    });

export default i18n;
