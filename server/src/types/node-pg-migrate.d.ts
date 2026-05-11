// Local ambient declaration for `node-pg-migrate`.
//
// The package ships a `package.json#exports` map that points its real types at
// `dist/bundle/index.d.ts`, but our server's `moduleResolution: "node"` (the
// classic resolver) doesn't follow exports maps and falls back to the legacy
// `main`/`types` fields, which point at non-existent files. Rather than rip
// up the tsconfig for the rest of the codebase, we declare the slim surface
// of the API we actually use.

declare module 'node-pg-migrate' {
    export interface ConnectionConfig {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
    }

    export interface RunnerOption {
        databaseUrl: string | ConnectionConfig;
        dir: string;
        migrationsTable?: string;
        migrationsSchema?: string;
        direction: 'up' | 'down';
        count?: number;
        verbose?: boolean;
        log?: (msg: string) => void;
        singleTransaction?: boolean;
    }

    export interface RunMigration {
        path: string;
        name: string;
        timestamp: number;
    }

    export function runner(options: RunnerOption): Promise<RunMigration[]>;
}
