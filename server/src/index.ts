import http from 'http';
import type { Duplex } from 'stream';
import { URL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import app from './app';
import pool, { runMigrations } from './db';
import logger from './lib/logger';
import { getJwtSecret } from './config/loadEnv';
import { ACCESS_COOKIE_NAME } from './middleware/auth';

const PORT = process.env.SERVER_PORT || 3001;

// =============================================================================
// WebSocket security
//
// The previous implementation accepted ANY incoming connection on /ws and then
// trusted a `{type:'auth', userId}` message sent in the clear by the client to
// associate the socket with a user. This meant any anonymous attacker could
// register as any user_id and receive broadcasts intended for that user.
//
// The fix authenticates *at the HTTP upgrade handshake*: the JWT is verified
// before the WebSocket is even established. If the token is missing or invalid
// the upgrade is rejected with HTTP 401 and the socket is destroyed.
//
// The token can be passed either through the standard Authorization header
// (non-browser clients) or through a `?token=...` query parameter (browser
// WebSocket API does not allow custom headers — this is the conventional
// workaround, paired with the recommendation to always run over wss:// in
// production so query params are not exposed on the wire).
// =============================================================================

const WS_PATH = '/ws';
const MAX_CONNECTIONS_PER_USER = 10;
const HEARTBEAT_INTERVAL_MS = 30_000;

interface AuthenticatedWebSocket extends WebSocket {
    userId: string;
    isAlive: boolean;
}

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server without binding to HTTP — we handle upgrades manually
// so we can authenticate before completing the handshake.
const wss = new WebSocketServer({ noServer: true });

// Connected sockets indexed by user id (one user can have several devices)
const clients = new Map<string, Set<AuthenticatedWebSocket>>();

// Parse a raw Cookie header into a map. Tiny inline parser — we don't want to
// depend on cookie-parser middleware here because the upgrade request hasn't
// gone through Express yet.
const parseCookieHeader = (header: string | undefined): Record<string, string> => {
    if (!header) return {};
    const out: Record<string, string> = {};
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const k = part.slice(0, eq).trim();
        const v = part.slice(eq + 1).trim();
        if (!k) continue;
        try {
            out[k] = decodeURIComponent(v);
        } catch {
            out[k] = v;
        }
    }
    return out;
};

const extractToken = (req: http.IncomingMessage): string | null => {
    // 1) httpOnly cookie sent automatically by the browser on same-origin WS
    //    upgrades. This is the default path for the SPA.
    const cookies = parseCookieHeader(req.headers['cookie']);
    const fromCookie = cookies[ACCESS_COOKIE_NAME];
    if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;

    // 2) Authorization: Bearer ... — for non-browser clients (CLI, tests).
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        const value = authHeader.slice(7).trim();
        if (value.length > 0) return value;
    }

    // 3) ?token=... query param — fallback for browser environments that
    //    cannot send custom headers and where the SPA is hosted cross-site
    //    relative to the API (cookie blocked by SameSite). Should be used only
    //    over wss:// in production.
    try {
        const url = new URL(req.url ?? '', 'http://localhost');
        const token = url.searchParams.get('token');
        if (token && token.trim().length > 0) return token.trim();
    } catch {
        // Malformed URL — fall through to null.
    }

    return null;
};

const denyUpgrade = (socket: Duplex, status: number, reason: string, remoteAddress?: string) => {
    logger.warn('ws.upgrade_denied', { status, reason, remoteAddress });
    socket.write(
        `HTTP/1.1 ${status} ${reason}\r\n` +
            'Connection: close\r\n' +
            'Content-Length: 0\r\n' +
            '\r\n',
    );
    socket.destroy();
};

server.on('upgrade', (req, socket, head) => {
    const remoteAddress = req.socket.remoteAddress;

    let pathname: string;
    try {
        pathname = new URL(req.url ?? '', 'http://localhost').pathname;
    } catch {
        return denyUpgrade(socket, 400, 'Bad Request', remoteAddress);
    }

    if (pathname !== WS_PATH) {
        return denyUpgrade(socket, 404, 'Not Found', remoteAddress);
    }

    const token = extractToken(req);
    if (!token) {
        return denyUpgrade(socket, 401, 'Unauthorized', remoteAddress);
    }

    let payload: { userId?: string; kind?: string };
    try {
        payload = jwt.verify(token, getJwtSecret()) as { userId?: string; kind?: string };
    } catch {
        return denyUpgrade(socket, 401, 'Unauthorized', remoteAddress);
    }

    const userId = payload?.userId;
    if (!userId || typeof userId !== 'string') {
        return denyUpgrade(socket, 401, 'Unauthorized', remoteAddress);
    }
    // Reject refresh tokens — only access tokens can open a WS.
    if (payload.kind && payload.kind !== 'access') {
        return denyUpgrade(socket, 401, 'Unauthorized', remoteAddress);
    }

    const existing = clients.get(userId);
    if (existing && existing.size >= MAX_CONNECTIONS_PER_USER) {
        return denyUpgrade(socket, 429, 'Too Many Connections', remoteAddress);
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
        const authedWs = ws as AuthenticatedWebSocket;
        authedWs.userId = userId;
        authedWs.isAlive = true;
        wss.emit('connection', authedWs, req);
    });
});

wss.on('connection', (ws: AuthenticatedWebSocket) => {
    const { userId } = ws;
    logger.info('ws.connection_open', { userId });

    if (!clients.has(userId)) {
        clients.set(userId, new Set());
    }
    clients.get(userId)!.add(ws);

    // Confirm the authenticated identity to the client so it knows it's ready
    // to receive broadcasts. We do NOT echo back the JWT or any sensitive data.
    ws.send(JSON.stringify({ type: 'connected' }));

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (raw: Buffer) => {
        // The server no longer accepts any client→server protocol over WS.
        // Any incoming message is logged at debug level and ignored. This keeps
        // the surface area minimal until task #22 introduces a real protocol.
        if (raw.length > 4096) return; // bound logging cost
        logger.debug('ws.message_ignored', {
            userId,
            byteLength: raw.length,
        });
    });

    ws.on('close', () => {
        const set = clients.get(userId);
        if (set) {
            set.delete(ws);
            if (set.size === 0) {
                clients.delete(userId);
            }
        }
        logger.info('ws.connection_closed', { userId });
    });

    ws.on('error', (error) => {
        logger.warn('ws.error', {
            userId,
            error: error instanceof Error ? error.message : String(error),
        });
    });
});

// Heartbeat — terminate sockets that stop responding to ping. Prevents resource
// leaks from half-open connections (mobile sleep, network drops).
const heartbeat = setInterval(() => {
    wss.clients.forEach((client) => {
        const ws = client as AuthenticatedWebSocket;
        if (ws.isAlive === false) {
            logger.info('ws.heartbeat_terminate', { userId: ws.userId });
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        try {
            ws.ping();
        } catch {
            // ignore — close handler will clean up
        }
    });
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => {
    clearInterval(heartbeat);
});

/**
 * Send a message to all open sockets of a given authenticated user.
 * The userId is server-trusted (came from a verified JWT at handshake).
 */
export const broadcast = (userId: string, data: unknown) => {
    const set = clients.get(userId);
    if (!set) return;
    const message = JSON.stringify(data);
    set.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
};

// Start server
const startServer = async () => {
    try {
        await runMigrations();
        // Test database connection
        await pool.query('SELECT NOW()');
        logger.info('server.database_connected');

        server.listen(PORT, () => {
            logger.info('server.started', {
                port: Number(PORT),
                httpUrl: `http://localhost:${PORT}`,
                wsUrl: `ws://localhost:${PORT}${WS_PATH}`,
            });
        });
    } catch (error) {
        logger.error('server.start_failed', {
            error: error instanceof Error ? error.message : String(error),
            stack:
                error instanceof Error && process.env.NODE_ENV !== 'production'
                    ? error.stack
                    : undefined,
        });
        process.exit(1);
    }
};

// Handle graceful shutdown
const shutdown = (signal: string) => {
    logger.info('server.signal_received', { signal });
    clearInterval(heartbeat);
    wss.clients.forEach((client) => client.terminate());
    server.close(() => {
        logger.info('server.closed');
        pool.end();
        process.exit(0);
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer();
