import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import http from 'http';

const SECRET = 'test-secret-with-at-least-32-characters!!';
const ACCESS_TTL = 60 * 60;
const REFRESH_TTL = 7 * 24 * 60 * 60;
const ACCESS_COOKIE = 'of_at';
const REFRESH_COOKIE = 'of_rt';

const sign = (userId, kind, ttl) => jwt.sign({ userId, kind }, SECRET, { expiresIn: ttl });
const verify = (token, kind) => {
    const p = jwt.verify(token, SECRET);
    if (p.kind !== kind) throw new Error('wrong kind');
    return p;
};
const setCookies = (res, userId) => {
    res.cookie(ACCESS_COOKIE, sign(userId, 'access', ACCESS_TTL), {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        maxAge: ACCESS_TTL * 1000,
    });
    res.cookie(REFRESH_COOKIE, sign(userId, 'refresh', REFRESH_TTL), {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/api/auth',
        maxAge: REFRESH_TTL * 1000,
    });
};
const clearCookies = (res) => {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
};
const auth = (req, res, next) => {
    try {
        const t =
            req.cookies?.[ACCESS_COOKIE] ||
            (req.headers.authorization?.startsWith('Bearer ')
                ? req.headers.authorization.slice(7).trim()
                : '');
        if (!t) return res.status(401).json({ success: false });
        req.userId = verify(t, 'access').userId;
        next();
    } catch {
        return res.status(401).json({ success: false });
    }
};

const app = express();
app.use(express.json());
app.use(cookieParser());
app.post('/api/auth/login', (req, res) => {
    if (req.body?.email === 'alice@x.com' && req.body?.password === 'goodpass1') {
        setCookies(res, 'alice-id');
        return res.json({
            success: true,
            data: { user: { id: 'alice-id', email: 'alice@x.com' } },
        });
    }
    res.status(401).json({ success: false });
});
app.post('/api/auth/refresh', (req, res) => {
    const t = req.cookies?.[REFRESH_COOKIE];
    if (!t) return res.status(401).json({ success: false });
    try {
        const p = verify(t, 'refresh');
        setCookies(res, p.userId);
        res.json({ success: true });
    } catch {
        clearCookies(res);
        res.status(401).json({ success: false });
    }
});
app.post('/api/auth/logout', (_req, res) => {
    clearCookies(res);
    res.json({ success: true });
});
app.get('/api/protected', auth, (_req, res) => res.json({ success: true }));

const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}`;

let pass = 0,
    fail = 0;
const A = (c, n, d = '') => {
    if (c) {
        console.log('  OK   ' + n);
        pass++;
    } else {
        console.log('  FAIL ' + n + (d ? '\n       ' + d : ''));
        fail++;
    }
};
const findCookie = (arr, name) => arr?.find((c) => c.startsWith(name + '=')) ?? null;
const cookieValue = (raw) => raw?.split(';')[0]?.split('=')[1];

console.log('\n=== 1. Login OK => cookies httpOnly avec bons flags ===');
let r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alice@x.com', password: 'goodpass1' }),
});
A(r.status === 200, 'login 200');
const body = await r.json();
A(body.data?.token === undefined, 'token absent du body');
const sc = r.headers.getSetCookie?.() ?? [];
const accessRaw = findCookie(sc, ACCESS_COOKIE);
const refreshRaw = findCookie(sc, REFRESH_COOKIE);
A(!!accessRaw && !!refreshRaw, '2 cookies posés', JSON.stringify(sc));
A(/HttpOnly/i.test(accessRaw), 'access HttpOnly');
A(/SameSite=Lax/i.test(accessRaw), 'access SameSite=Lax');
A(
    /Path=\//i.test(accessRaw) && !/Path=\/api/i.test(accessRaw),
    `access Path=/ (got: ${accessRaw})`,
);
A(/HttpOnly/i.test(refreshRaw), 'refresh HttpOnly');
A(/SameSite=Strict/i.test(refreshRaw), 'refresh SameSite=Strict');
A(/Path=\/api\/auth/i.test(refreshRaw), `refresh Path=/api/auth (got: ${refreshRaw})`);

const accessTok = cookieValue(accessRaw);
const refreshTok = cookieValue(refreshRaw);

console.log('\n=== 2. Access protégé OK avec cookie ===');
r = await fetch(`${base}/api/protected`, { headers: { Cookie: `${ACCESS_COOKIE}=${accessTok}` } });
A(r.status === 200, 'protected OK');

console.log('\n=== 3. Sans cookie => 401 ===');
r = await fetch(`${base}/api/protected`);
A(r.status === 401, 'aucun cookie => 401');

console.log('\n=== 4. Refresh token NE PEUT PAS être utilisé comme access (kind check) ===');
r = await fetch(`${base}/api/protected`, { headers: { Cookie: `${ACCESS_COOKIE}=${refreshTok}` } });
A(r.status === 401, 'refresh comme access => 401');

console.log('\n=== 5. Access token NE PEUT PAS être utilisé comme refresh ===');
r = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `${REFRESH_COOKIE}=${accessTok}` },
});
A(r.status === 401, 'access comme refresh => 401');

console.log('\n=== 6. Refresh OK (avec délai pour rotation visible) ===');
await new Promise((r) => setTimeout(r, 1100)); // attendre >1s pour iat différent
r = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `${REFRESH_COOKIE}=${refreshTok}` },
});
A(r.status === 200, 'refresh 200');
const sc2 = r.headers.getSetCookie?.() ?? [];
const access2 = findCookie(sc2, ACCESS_COOKIE);
A(!!access2, 'nouveau access cookie posé');
const newAccessTok = cookieValue(access2);
A(
    newAccessTok !== accessTok,
    `nouveau token différent (anciens iat: ${jwt.decode(accessTok).iat}, nouveau: ${jwt.decode(newAccessTok).iat})`,
);
r = await fetch(`${base}/api/protected`, {
    headers: { Cookie: `${ACCESS_COOKIE}=${newAccessTok}` },
});
A(r.status === 200, 'nouveau access token marche');

console.log('\n=== 7. Refresh sans cookie => 401 ===');
r = await fetch(`${base}/api/auth/refresh`, { method: 'POST' });
A(r.status === 401, 'no refresh cookie => 401');

console.log('\n=== 8. Logout => clear cookies ===');
r = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
A(r.status === 200, 'logout 200');
const scLogout = r.headers.getSetCookie?.() ?? [];
A(
    scLogout.some((c) => c.startsWith(ACCESS_COOKIE + '=')),
    'access clear envoyé',
);
A(
    scLogout.some((c) => c.startsWith(REFRESH_COOKIE + '=')),
    'refresh clear envoyé',
);
// Express's clearCookie produit une expires dans le passé
A(
    scLogout.every((c) => /Expires=Thu, 01 Jan 1970/i.test(c) || /Max-Age=0/i.test(c)),
    'cookies expirés (1970 ou Max-Age=0)',
);

console.log('\n=== 9. Bearer header reste supporté (fallback non-navigateur) ===');
r = await fetch(`${base}/api/protected`, { headers: { Authorization: `Bearer ${newAccessTok}` } });
A(r.status === 200, 'Bearer fonctionne');

console.log(`\nRésumé: ${pass} pass, ${fail} fail`);
server.close();
process.exit(fail === 0 ? 0 : 1);
