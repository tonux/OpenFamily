// Flat config (ESLint v9). One root config for the whole monorepo, with
// scoped overrides for the React client and the Node server.
//
// Philosophy: stay forgiving on day 1. We're plugging lint onto a codebase
// that has lived without it — surfacing real errors only. Strictness can be
// dialled up later (e.g. promote `no-unused-vars` from warn to error, enable
// `@typescript-eslint/no-floating-promises`, etc.).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
    {
        ignores: [
            '**/dist/**',
            '**/build/**',
            '**/coverage/**',
            '**/.vite/**',
            '**/*.tsbuildinfo',
            'client/public/**',
            'server/migrations/**',
            // Generated artifacts and one-off ad-hoc scripts used during smoke
            // testing — not production code.
            'server/test-*.mjs',
            'server/test-*.cjs',
        ],
    },

    // Base TS rules — applied to everything.
    ...tseslint.configs.recommended,

    {
        rules: {
            // The codebase has plenty of `unused arg` patterns (express
            // handlers, intentional placeholders). Demote to warning so we can
            // see them without blocking commits.
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            // `any` is widespread today. Warn, don't error.
            '@typescript-eslint/no-explicit-any': 'warn',
            // Some routes do `if (!x) return res.json(...)` without `return`
            // outside — Express doesn't care. Don't fight legacy.
            '@typescript-eslint/no-empty-function': 'off',
        },
    },

    // Server — Node globals.
    {
        files: ['server/**/*.ts'],
        languageOptions: {
            globals: { ...globals.node },
            parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        },
        rules: {
            'no-console': ['warn', { allow: ['warn', 'error'] }],
        },
    },

    // Client — Browser globals + React rules.
    {
        files: ['client/**/*.{ts,tsx}'],
        languageOptions: {
            globals: { ...globals.browser },
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                ecmaFeatures: { jsx: true },
            },
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            // Pull in the full recommended set, then downgrade every rule
            // from "error" to "warn". eslint-plugin-react-hooks v7 introduced
            // several new strict rules (set-state-in-effect, etc.) that the
            // existing codebase doesn't satisfy yet. Surfacing them as
            // warnings keeps the migration unblocked without losing the
            // signal — they can be promoted back to errors as the audit
            // findings are addressed.
            ...Object.fromEntries(
                Object.entries(reactHooks.configs.recommended.rules ?? {}).map(([k, v]) => [
                    k,
                    Array.isArray(v) ? ['warn', ...v.slice(1)] : 'warn',
                ]),
            ),
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
        },
    },

    // Tests — Vitest globals + relaxed rules.
    {
        files: ['**/*.{test,spec}.{ts,tsx,mjs,cjs,js}', 'server/test/**/*.ts'],
        languageOptions: { globals: { ...globals.node, ...globals.vitest } },
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            'no-console': 'off',
        },
    },

    // Shared package.
    {
        files: ['shared/**/*.ts'],
        languageOptions: {
            globals: { ...globals.node },
            parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        },
    },

    // Disable formatting-style rules so Prettier owns formatting.
    {
        rules: {
            // Anything that conflicts with Prettier should be off. The
            // typescript-eslint recommended preset doesn't include style rules
            // any more, so we just keep this slot for clarity.
        },
    },
);
