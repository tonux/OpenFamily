// Lance l'app Express compilée (sans DB) et vérifie les nouvelles protections.
// La DB n'est pas requise pour: /health, validate UUID (rejette avant la route), rate-limit, headers helmet.
process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters!!';
process.env.NODE_ENV = 'test';
process.env.API_RATE_LIMIT_MAX = '5';
process.env.API_RATE_LIMIT_WINDOW_MS = '60000';

// On stub la DB pour éviter qu'elle plante au boot
import { register } from 'module';
import { pathToFileURL } from 'url';

// Charge l'app via le build TS compilé
const { default: app } = await import('./dist/app.js');

const http = await import('http');
const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}`;

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

console.log('\n=== 1. /health renvoie 200 et ne consomme pas le rate-limit ===');
for (let i = 0; i < 10; i++) {
    const r = await fetch(`${base}/health`);
    if (i === 0) A(r.status === 200, '/health => 200');
    if (i === 9) A(r.status === 200, '10ème /health => toujours 200 (pas de rate-limit)');
}

console.log('\n=== 2. Helmet pose les bons headers ===');
const r = await fetch(`${base}/health`);
A(
    r.headers.get('x-frame-options') === 'SAMEORIGIN' ||
        r.headers.get('x-frame-options') === 'DENY',
    'X-Frame-Options posé',
    `got=${r.headers.get('x-frame-options')}`,
);
A(r.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
A(
    !!r.headers.get('strict-transport-security'),
    'HSTS posé',
    `got=${r.headers.get('strict-transport-security')}`,
);
A(
    r.headers.get('cross-origin-resource-policy') === 'cross-origin',
    'CORP=cross-origin (compat CORS)',
);
A(!r.headers.get('content-security-policy'), 'CSP volontairement absent (API JSON)');

console.log('\n=== 3. Validation UUID sur /:id ===');
// Route /api/family/:id requiert auth, mais le validateUuidParam s'exécute AVANT le authMiddleware
// donc on doit obtenir 400 avant le 401.
let bad = await fetch(`${base}/api/family/not-a-uuid`);
A(bad.status === 400, 'GET /api/family/not-a-uuid => 400');
const body = await bad.json();
A(
    body.success === false && /uuid/i.test(body.error),
    "message d'erreur explicite UUID",
    JSON.stringify(body),
);

// Plusieurs formats invalides
for (const id of ['12345', '00000000-0000-0000-0000-000000000000', 'abc-def', 'null']) {
    bad = await fetch(`${base}/api/family/${id}`);
    A(bad.status === 400, `id="${id}" => 400`);
}

// UUID valide => doit passer le validateur et arriver au authMiddleware (qui renverra 401 vu qu'on n'a pas de token)
const goodId = '550e8400-e29b-41d4-a716-446655440000';
const good = await fetch(`${base}/api/family/${goodId}`);
A(good.status === 401, `UUID valide => passe validateur, atteint auth (401)`);

console.log('\n=== 4. Rate-limit global sur /api ===');
// On a configuré max=5/min sur /api. On enchaîne 8 requêtes.
const statuses = [];
for (let i = 0; i < 8; i++) {
    const r2 = await fetch(`${base}/api/family/${goodId}`);
    statuses.push(r2.status);
}
const num429 = statuses.filter((s) => s === 429).length;
A(num429 >= 1, `Au moins 1 réponse 429 après 5 requêtes (got: [${statuses.join(',')}])`);
A(
    statuses.slice(0, 5).every((s) => s !== 429),
    '5 premières requêtes ne sont PAS rate-limitées',
);

console.log('\n=== 5. /health échappe au rate-limit même après /api saturé ===');
const h = await fetch(`${base}/health`);
A(h.status === 200, '/health toujours OK');

console.log(`\nRésumé: ${pass} pass, ${fail} fail`);
server.close();
process.exit(fail === 0 ? 0 : 1);
