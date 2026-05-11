import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['test/**/*.test.ts'],
        // Each test file gets a fresh module registry so env-driven config
        // (JWT secret, etc.) can be set before importing the module under test.
        isolate: true,
        // The auth tests need a strong JWT secret to import middleware/auth.
        // Setting it here is convenient; tests can still override per-suite.
        setupFiles: ['./test/setup.ts'],
    },
});
