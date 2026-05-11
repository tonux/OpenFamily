/** @type {import("prettier").Config} */
export default {
    semi: true,
    singleQuote: true,
    trailingComma: 'all',
    tabWidth: 4,
    printWidth: 100,
    arrowParens: 'always',
    endOfLine: 'lf',
    overrides: [
        {
            files: ['*.md', '*.yml', '*.yaml', '*.json'],
            options: { tabWidth: 2 },
        },
    ],
};
