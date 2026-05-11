import path from 'path';
import { Pool, types } from 'pg';
import { runner } from 'node-pg-migrate';
import { loadEnv } from './config/loadEnv';
import logger from './lib/logger';

loadEnv();

// Return DATE columns as plain 'YYYY-MM-DD' strings instead of JavaScript Date objects.
// This prevents timezone-related date shifts (e.g. '2026-03-09' → '2026-03-08T23:00:00.000Z').
types.setTypeParser(1082, (val: string) => val);

const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'openfamily',
    user: process.env.POSTGRES_USER || 'openfamily',
    password: process.env.POSTGRES_PASSWORD || 'changeme',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    logger.error('db.pool_error', {
        error: err instanceof Error ? err.message : String(err),
        stack:
            err instanceof Error && process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    });
    process.exit(-1);
});

export const query = async (text: string, params?: any[]) => {
    const start = Date.now();
    const operation = text.trim().split(/\s+/)[0]?.toUpperCase() || 'UNKNOWN';

    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        logger.debug('db.query', {
            operation,
            durationMs: duration,
            rows: res.rowCount ?? 0,
            hasParams: Array.isArray(params) && params.length > 0,
        });
        return res;
    } catch (error) {
        logger.error('db.query_error', {
            operation,
            error: error instanceof Error ? error.message : String(error),
            stack:
                error instanceof Error && process.env.NODE_ENV !== 'production'
                    ? error.stack
                    : undefined,
        });
        throw error;
    }
};

export const getClient = async () => {
    const client = await pool.connect();
    const query = client.query.bind(client);
    const release = client.release.bind(client);

    // Set a timeout of 5 seconds, after which we will log this client's last query
    const timeout = setTimeout(() => {
        logger.warn('db.client_checkout_timeout', { timeoutMs: 5000 });
    }, 5000);

    // Monkey patch the query method to keep track of the last query executed
    client.query = ((...args: Parameters<typeof query>) => {
        return query(...args);
    }) as typeof client.query;

    client.release = () => {
        clearTimeout(timeout);
        return release();
    };

    return client;
};

// Resolve the migrations folder relative to the compiled output (dist/db.js)
// or the source (src/db.ts). At runtime __dirname is either:
//   server/dist  → ../migrations
//   server/src   → ../migrations  (under tsx)
// so this single resolution works for both.
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

/**
 * Apply all pending database migrations from server/migrations/. Backed by
 * node-pg-migrate: tracks history in a `pgmigrations` table, runs each
 * migration exactly once, and applies them inside a transaction so a failure
 * leaves the database untouched.
 *
 * Migration files use the `.sql` format with `-- Up Migration` / `-- Down
 * Migration` markers. New migrations should be created with:
 *   npm run db:migrate:create -- <name>
 * which scaffolds a properly-timestamped file in server/migrations/.
 */
export const runMigrations = async (): Promise<void> => {
    logger.info('db.migrations_start');

    try {
        const ran = await runner({
            // Reuse the same pool config so we never open a second connection.
            databaseUrl: {
                host: process.env.POSTGRES_HOST || 'localhost',
                port: parseInt(process.env.POSTGRES_PORT || '5432'),
                database: process.env.POSTGRES_DB || 'openfamily',
                user: process.env.POSTGRES_USER || 'openfamily',
                password: process.env.POSTGRES_PASSWORD || 'changeme',
            },
            dir: MIGRATIONS_DIR,
            migrationsTable: 'pgmigrations',
            direction: 'up',
            count: Infinity,
            // SQL migrations use plain pg_sql by default; we set it explicitly
            // for clarity.
            migrationsSchema: 'public',
            verbose: false,
            // node-pg-migrate writes to console by default. Silence it; we
            // produce our own structured log line below.
            log: () => undefined,
        });

        logger.info('db.migrations_complete', {
            applied: ran.length,
            names: ran.map((m) => m.name),
        });
    } catch (error) {
        logger.error('db.migrations_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
};

export default pool;
