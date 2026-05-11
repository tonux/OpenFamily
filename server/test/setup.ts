// Globally apply test-friendly env before any module is imported.
// loadEnv() validates JWT_SECRET length & non-placeholder value — we satisfy
// it once here so every test file gets a working config without boilerplate.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'unit-tests-secret-with-32-chars-min!!!';
process.env.REGISTRATION_ENABLED = process.env.REGISTRATION_ENABLED ?? 'true';
