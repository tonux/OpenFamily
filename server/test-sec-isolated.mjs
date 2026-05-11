import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import http from 'http';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_REGEX.test(v);
const validateUuidParam = (req, res, next, value, name) => {
    if (isUuid(value)) return next();
    res.status(400).json({ success: false, error: `Invalid ${name}: expected a UUID` });
};

let pass = 0,
    fail = 0;
const A = (cond, name, detail = '') => {
    if (cond) {
        console.log('  OK   ' + name);
        pass++;
    } else {
        console.log('  FAIL ' + name + (detail ? '\n       ' + detail : ''));
        fail++;
    }
};

// ----- App A : tests UUID + helmet avec rate-limit large -----
async function makeApp(max) {
    const app = express();
    app.use(
        helmet({
            contentSecurityPolicy: false,
            crossOriginResourcePolicy: { policy: 'cross-origin' },
        }),
    );
    app.use(express.json());
    app.param('id', validateUuidParam);
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    app.use(
        '/api',
        rateLimit({
            windowMs: 60_000,
            max,
            standardHeaders: true,
            legacyHeaders: false,
            message: { success: false, error: 'rate' },
        }),
    );
    app.get('/api/family/:id', (req, res) =>
        res.status(401).json({ success: false, error: 'No token' }),
    );
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    return { server, port: server.address().port };
}

console.log('\n=== 1+2. Headers helmet + /health non rate-limité ===');
let { server, port } = await makeApp(1000);
let base = `http://localhost:${port}`;
for (let i = 0; i < 10; i++) await fetch(`${base}/health`);
const r0 = await fetch(`${base}/health`);
A(r0.status === 200, '/health: 11ème appel toujours 200');
A(['SAMEORIGIN', 'DENY'].includes(r0.headers.get('x-frame-options')), 'X-Frame-Options posé');
A(r0.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
A(!!r0.headers.get('strict-transport-security'), 'HSTS posé');
A(r0.headers.get('cross-origin-resource-policy') === 'cross-origin', 'CORP=cross-origin');
A(!r0.headers.get('content-security-policy'), 'CSP volontairement absent');
A(!r0.headers.get('x-powered-by'), 'X-Powered-By retiré');

console.log('\n=== 3. Validation UUID (rate-limit large) ===');
for (const id of [
    'not-a-uuid',
    '12345',
    '00000000-0000-0000-0000-000000000000',
    'abc-def',
    'null',
    '550e8400-e29b-71d4-a716-446655440000',
]) {
    const r = await fetch(`${base}/api/family/${encodeURIComponent(id)}`);
    A(r.status === 400, `id="${id}" => 400`);
}
const goodId = '550e8400-e29b-41d4-a716-446655440000';
const goodRes = await fetch(`${base}/api/family/${goodId}`);
A(goodRes.status === 401, `UUID valide => passe validateur, atteint route (401 simulé)`);
const goodBody = await goodRes.json();
A(
    goodBody.error === 'No token',
    'route handler atteint (preuve que le validateur a laissé passer)',
);
server.close();

console.log('\n=== 4. Rate-limit global (app dédiée, max=5) ===');
({ server, port } = await makeApp(5));
base = `http://localhost:${port}`;
const statuses = [];
for (let i = 0; i < 8; i++) {
    const r = await fetch(`${base}/api/family/${goodId}`);
    statuses.push(r.status);
}
A(
    statuses.slice(0, 5).every((s) => s === 401),
    `5 premières: pas rate-limited (statuses: [${statuses.slice(0, 5).join(',')}])`,
);
A(
    statuses.slice(5).every((s) => s === 429),
    `6-8ème: rate-limited 429 (statuses: [${statuses.slice(5).join(',')}])`,
);

console.log('\n=== 5. /health échappe au rate-limit même quand /api est saturé ===');
const h = await fetch(`${base}/health`);
A(h.status === 200, '/health toujours OK');
server.close();

console.log(`\nRésumé: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
