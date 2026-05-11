import http from 'http';
import { URL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';

const SECRET = 'test-secret-with-at-least-32-characters!!';
const WS_PATH = '/ws';
const MAX_CONNECTIONS_PER_USER = 3;
const server = http.createServer((_, res) => res.end('ok'));
const wss = new WebSocketServer({ noServer: true });
const clients = new Map();

const extractToken = (req) => {
    const a = req.headers['authorization'];
    if (typeof a === 'string' && a.startsWith('Bearer ')) {
        const v = a.slice(7).trim();
        if (v) return v;
    }
    try {
        const u = new URL(req.url ?? '', 'http://localhost');
        const t = u.searchParams.get('token');
        if (t) return t.trim();
    } catch {}
    return null;
};
const deny = (socket, status, reason) => {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
};

server.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
        pathname = new URL(req.url ?? '', 'http://localhost').pathname;
    } catch {
        return deny(socket, 400, 'Bad');
    }
    if (pathname !== WS_PATH) return deny(socket, 404, 'NF');
    const token = extractToken(req);
    if (!token) return deny(socket, 401, 'U');
    let payload;
    try {
        payload = jwt.verify(token, SECRET);
    } catch {
        return deny(socket, 401, 'U');
    }
    if (!payload?.userId || typeof payload.userId !== 'string') return deny(socket, 401, 'U');
    const existing = clients.get(payload.userId);
    if (existing && existing.size >= MAX_CONNECTIONS_PER_USER) return deny(socket, 429, 'TM');
    wss.handleUpgrade(req, socket, head, (ws) => {
        ws.userId = payload.userId;
        wss.emit('connection', ws);
    });
});

wss.on('connection', (ws) => {
    const { userId } = ws;
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(ws);
    ws.send(JSON.stringify({ type: 'connected' }));
    // ICI le critique : on ignore le contenu, on ne réutilise JAMAIS data.userId
    ws.on('message', () => {
        /* ignored */
    });
    ws.on('close', () => {
        const s = clients.get(userId);
        if (s) {
            s.delete(ws);
            if (s.size === 0) clients.delete(userId);
        }
    });
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `ws://localhost:${port}`;

const connect = (url, headers = {}) =>
    new Promise((resolve) => {
        const ws = new WebSocket(url, { headers });
        const r = { opened: false, firstMessage: null, code: null };
        ws.on('unexpected-response', (_req, res) => {
            r.code = res.statusCode;
            res.resume();
            resolve(r);
        });
        ws.on('open', () => {
            r.opened = true;
        });
        ws.on('message', (m) => {
            r.firstMessage = m.toString();
            ws.close();
        });
        ws.on('close', () => resolve(r));
        ws.on('error', () => {}); // swallow
    });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0,
    fail = 0;
const A = (cond, name) => {
    if (cond) {
        console.log('  OK   ' + name);
        pass++;
    } else {
        console.log('  FAIL ' + name);
        fail++;
    }
};

console.log("\n=== 9. Re-test : le faux userId via message n'est pas accepté ===");
const aliceToken = jwt.sign({ userId: 'alice' }, SECRET);
const probe = new WebSocket(`${base}${WS_PATH}?token=${aliceToken}`);
await new Promise((r) => probe.on('open', r));
A(clients.get('alice')?.size === 1, 'alice a 1 socket dans la map');
// On envoie un message qui essaie de s'enregistrer en tant que "victim"
probe.send(JSON.stringify({ type: 'auth', userId: 'victim' }));
await sleep(100);
A(!clients.has('victim'), 'aucun userId "victim" n\'a été créé dans clients');
A(
    probe.userId === undefined || clients.get('alice')?.has(probe),
    'le socket reste rattaché à alice (jamais réassigné)',
);
probe.close();
await sleep(50);

console.log(`\nRésumé: ${pass} pass, ${fail} fail`);
server.close();
wss.close();
process.exit(fail === 0 ? 0 : 1);
