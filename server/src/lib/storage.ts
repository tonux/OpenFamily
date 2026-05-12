import {
    CreateBucketCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    PutObjectCommand,
    S3Client,
    type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import logger from './logger';
import { StorageError } from './storage-errors';

// =============================================================================
// Storage service
//
// Thin wrapper around an S3-compatible client (MinIO in our docker-compose).
// We use the AWS SDK so a future swap to AWS S3 / Scaleway / OVH is purely
// configuration: same code, different env vars.
//
// Design choices:
//   - Single shared bucket; per-user isolation via a `user-{userId}/` prefix
//     in the object key plus the SQL filter `WHERE user_id = $1` on every
//     read. There's no scenario where the S3 layer alone would be the
//     security boundary.
//   - `forcePathStyle: true` is required for MinIO — virtual-host-style
//     addressing isn't reachable through the docker network.
//   - The bucket is created lazily on boot from `ensureBucket()` so a fresh
//     env (CI, dev) doesn't need a manual setup step.
// =============================================================================

interface StorageConfig {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    region: string;
    maxUploadSizeMb: number;
}

const parseIntEnv = (raw: string | undefined, fallback: number): number => {
    const n = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

let cachedConfig: StorageConfig | null = null;
let cachedClient: S3Client | null = null;

export const getStorageConfig = (): StorageConfig => {
    if (cachedConfig) return cachedConfig;
    cachedConfig = {
        endpoint: process.env.MINIO_ENDPOINT?.trim() || 'http://minio:9000',
        accessKey: process.env.MINIO_ACCESS_KEY?.trim() || 'openfamily',
        secretKey: process.env.MINIO_SECRET_KEY?.trim() || 'openfamily-minio-2024',
        bucket: process.env.MINIO_BUCKET?.trim() || 'openfamily',
        // Region is irrelevant for MinIO but the SDK requires *something*.
        region: process.env.MINIO_REGION?.trim() || 'us-east-1',
        maxUploadSizeMb: parseIntEnv(process.env.MAX_UPLOAD_SIZE_MB, 50),
    };
    return cachedConfig;
};

const getClient = (): S3Client => {
    if (cachedClient) return cachedClient;
    const cfg = getStorageConfig();
    const opts: S3ClientConfig = {
        endpoint: cfg.endpoint,
        region: cfg.region,
        credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
        forcePathStyle: true, // MinIO requirement
    };
    cachedClient = new S3Client(opts);
    return cachedClient;
};

/**
 * Ensure the configured bucket exists. Idempotent — called at server boot.
 * Throws a typed StorageError on failure so the caller can decide whether
 * to crash or run degraded.
 */
export const ensureBucket = async (): Promise<void> => {
    const cfg = getStorageConfig();
    const client = getClient();
    try {
        await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
        logger.info('storage.bucket_ready', { bucket: cfg.bucket, endpoint: cfg.endpoint });
        return;
    } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
            ?.httpStatusCode;
        if (status !== 404 && status !== 403 && status !== 301) {
            // 404 = doesn't exist, we'll create it. 403/301 = bucket exists
            // somewhere else — for MinIO this happens with HEAD on a missing
            // bucket sometimes; we'll attempt CreateBucket and rely on its
            // own conflict detection.
            logger.warn('storage.head_bucket_unexpected', { status });
        }
    }

    try {
        await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
        logger.info('storage.bucket_created', { bucket: cfg.bucket });
    } catch (err) {
        const code = (err as { Code?: string; name?: string })?.Code ?? (err as Error)?.name;
        // BucketAlreadyOwnedByYou / BucketAlreadyExists: someone (or another
        // boot) already created it. Idempotent success.
        if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
            logger.info('storage.bucket_already_exists', { bucket: cfg.bucket });
            return;
        }
        throw new StorageError(
            'PROVIDER_ERROR',
            `Failed to create bucket "${cfg.bucket}": ${
                err instanceof Error ? err.message : String(err)
            }`,
            err,
        );
    }
};

/**
 * Build the storage key for an upload. Caller controls the `documentId` so
 * the DB row and the S3 object share the same UUID for easy correlation.
 * The original extension is preserved (lowercased) for tools that sniff by
 * extension (browsers serving without explicit Content-Type).
 */
export const buildKey = (userId: string, documentId: string, originalFilename: string): string => {
    const rawExt = extname(originalFilename).toLowerCase();
    // Strip anything weird; keep only .a-z0-9
    const ext = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : '';
    return `user-${userId}/${documentId}${ext}`;
};

export const generateDocumentId = (): string => randomUUID();

export interface PutObjectInput {
    key: string;
    body: Buffer | Uint8Array | Readable;
    contentType: string;
    contentLength?: number;
}

export const putObject = async (input: PutObjectInput): Promise<void> => {
    const cfg = getStorageConfig();
    const client = getClient();
    try {
        await client.send(
            new PutObjectCommand({
                Bucket: cfg.bucket,
                Key: input.key,
                Body: input.body,
                ContentType: input.contentType,
                ContentLength: input.contentLength,
            }),
        );
    } catch (err) {
        throw new StorageError(
            'PROVIDER_ERROR',
            `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
            err,
        );
    }
};

export interface GetObjectResult {
    body: Readable;
    contentType: string | undefined;
    contentLength: number | undefined;
}

export const getObjectStream = async (key: string): Promise<GetObjectResult> => {
    const cfg = getStorageConfig();
    const client = getClient();
    try {
        const response = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        const body = response.Body as Readable | undefined;
        if (!body) {
            throw new StorageError('PROVIDER_ERROR', 'Empty object body');
        }
        return {
            body,
            contentType: response.ContentType,
            contentLength: response.ContentLength,
        };
    } catch (err) {
        const code = (err as { Code?: string; name?: string })?.Code ?? (err as Error)?.name;
        if (code === 'NoSuchKey' || code === 'NotFound') {
            throw new StorageError('NOT_FOUND', `Object not found: ${key}`, err);
        }
        throw new StorageError(
            'PROVIDER_ERROR',
            `Download failed: ${err instanceof Error ? err.message : String(err)}`,
            err,
        );
    }
};

export const deleteObject = async (key: string): Promise<void> => {
    const cfg = getStorageConfig();
    const client = getClient();
    try {
        await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    } catch (err) {
        // Treat NoSuchKey as success — caller wants the key gone, mission
        // accomplished one way or the other.
        const code = (err as { Code?: string; name?: string })?.Code ?? (err as Error)?.name;
        if (code === 'NoSuchKey' || code === 'NotFound') return;
        throw new StorageError(
            'PROVIDER_ERROR',
            `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
            err,
        );
    }
};

/** Test helper: reset cached client so tests can swap env vars. */
export const _resetStorageCache = (): void => {
    cachedConfig = null;
    cachedClient = null;
};
