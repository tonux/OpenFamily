import { Router } from 'express';
import multer from 'multer';
import { query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
    ALLOWED_MIME_TYPES,
    DOCUMENT_CATEGORIES,
    documentListQuerySchema,
    documentPatchSchema,
    ENTITY_COLUMN,
    ENTITY_TYPES,
    type DocumentCategory,
    type EntityType,
} from '../schemas/documents';
import {
    buildKey,
    deleteObject,
    generateDocumentId,
    getObjectStream,
    getStorageConfig,
    putObject,
} from '../lib/storage';
import { StorageError } from '../lib/storage-errors';
import logger from '../lib/logger';

// =============================================================================
// /api/documents
//
// Upload-then-stream model: client → server (multipart) → MinIO. Downloads
// are proxied through the server so we can verify ownership on every byte.
// Pricier in bandwidth than presigned URLs but trivially safer for v1; we
// can swap to presigning later without UI changes.
// =============================================================================

const router = Router();
router.use(authMiddleware);

const cfg = getStorageConfig();

// Multer holds the upload in memory because the file ends up streamed to
// MinIO immediately and never touches local disk. The hard fileSize cap
// stops a hostile (or sleepy) client from filling RAM with one huge POST.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: cfg.maxUploadSizeMb * 1024 * 1024, files: 1 },
});

// ---------- Helpers ----------

const mapDocument = (row: any) => ({
    id: row.id as string,
    name: row.name as string,
    category: row.category as string,
    file_name: row.file_name as string,
    file_size: Number(row.file_size),
    mime_type: row.mime_type as string,
    storage_key: row.storage_key as string,
    equipment_id: row.equipment_id ?? null,
    contract_id: row.contract_id ?? null,
    contact_id: row.contact_id ?? null,
    item_id: row.item_id ?? null,
    project_id: row.project_id ?? null,
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

const isAllowedMime = (mime: string): boolean =>
    (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);

const isDocumentCategory = (s: unknown): s is DocumentCategory =>
    typeof s === 'string' && (DOCUMENT_CATEGORIES as readonly string[]).includes(s);

const isEntityType = (s: unknown): s is EntityType =>
    typeof s === 'string' && (ENTITY_TYPES as readonly string[]).includes(s);

// Maps an entity_type to the DB table that owns it. Used for the
// `WHERE id = $1 AND user_id = $2` ownership check before we accept a
// link. Centralised so adding a new entity is a one-line change.
const ENTITY_TABLE: Record<EntityType, string> = {
    equipment: 'house_equipments',
    contract: 'house_contracts',
    contact: 'house_contacts',
    item: 'house_items',
    project: 'house_projects',
};

const ensureEntityBelongsToUser = async (
    type: EntityType,
    id: string,
    userId: string,
): Promise<void> => {
    const table = ENTITY_TABLE[type];
    const r = await query(`SELECT id FROM ${table} WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (r.rows.length === 0) throw new Error('INVALID_ENTITY');
};

// ---------- POST /upload ----------

// We let multer's error handler bubble up as a JSON body — it throws
// MulterError with `code = 'LIMIT_FILE_SIZE'` etc. that we map to HTTP.
router.post(
    '/upload',
    (req, res, next) => {
        upload.single('file')(req, res, (err: unknown) => {
            if (!err) return next();
            if ((err as { code?: string })?.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({
                    success: false,
                    error: {
                        code: 'FILE_TOO_LARGE',
                        message: `Fichier trop volumineux (max ${cfg.maxUploadSizeMb} MB)`,
                    },
                });
            }
            logger.warn('documents.upload_multer_error', {
                error: err instanceof Error ? err.message : String(err),
            });
            return res.status(400).json({ success: false, error: 'Upload error' });
        });
    },
    async (req: AuthRequest, res) => {
        const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
        if (!file) {
            return res
                .status(400)
                .json({ success: false, error: 'Missing "file" multipart field' });
        }

        const { name, category, notes, entity_type, entity_id } = req.body as Record<
            string,
            string | undefined
        >;

        // Validate the form fields by hand — multer parsed multipart, so
        // we're past the json validator middleware. Mirror what the zod
        // patch schema enforces.
        const cleanedName = (name ?? file.originalname).trim();
        if (!cleanedName) {
            return res.status(400).json({ success: false, error: 'name is required' });
        }
        if (!isDocumentCategory(category)) {
            return res
                .status(400)
                .json({ success: false, error: 'category is required and must be a known value' });
        }
        if (!isAllowedMime(file.mimetype)) {
            return res.status(415).json({
                success: false,
                error: {
                    code: 'UNSUPPORTED_MIME',
                    message: `Type de fichier non supporté: ${file.mimetype}`,
                },
            });
        }
        // Link target validation — both fields must be set together (or
        // neither).
        if ((entity_type && !entity_id) || (!entity_type && entity_id)) {
            return res.status(400).json({
                success: false,
                error: 'entity_type and entity_id must be provided together',
            });
        }
        if (entity_type && !isEntityType(entity_type)) {
            return res.status(400).json({ success: false, error: 'invalid entity_type' });
        }
        // After the isEntityType check we know `entity_type` is narrowed,
        // but TS lost track through the inline if; re-cast for clarity.
        const linkedType = entity_type as EntityType | undefined;

        try {
            if (linkedType && entity_id) {
                await ensureEntityBelongsToUser(linkedType, entity_id, req.userId!);
            }

            const documentId = generateDocumentId();
            const storageKey = buildKey(req.userId!, documentId, file.originalname);

            // 1. Upload to MinIO. If this fails we abort — no DB row left
            //    pointing nowhere.
            await putObject({
                key: storageKey,
                body: file.buffer,
                contentType: file.mimetype,
                contentLength: file.size,
            });

            // 2. Insert metadata. If this fails we'd ideally roll back the
            //    S3 object — best-effort delete with a warn log.
            const linkColumn = linkedType ? ENTITY_COLUMN[linkedType] : null;
            const cols = [
                'id',
                'user_id',
                'name',
                'category',
                'file_name',
                'file_size',
                'mime_type',
                'storage_key',
                'notes',
            ];
            const vals: any[] = [
                documentId,
                req.userId,
                cleanedName,
                category,
                file.originalname,
                file.size,
                file.mimetype,
                storageKey,
                notes?.trim() || null,
            ];
            if (linkColumn) {
                cols.push(linkColumn);
                vals.push(entity_id);
            }
            const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');

            try {
                const r = await query(
                    `INSERT INTO house_documents (${cols.join(', ')})
                     VALUES (${placeholders})
                     RETURNING *`,
                    vals,
                );
                return res.status(201).json({ success: true, data: mapDocument(r.rows[0]) });
            } catch (dbErr) {
                logger.error('documents.metadata_insert_failed_rolling_back_s3', {
                    storageKey,
                    error: dbErr instanceof Error ? dbErr.message : String(dbErr),
                });
                await deleteObject(storageKey).catch((cleanupErr) => {
                    logger.error('documents.s3_rollback_failed', {
                        storageKey,
                        error:
                            cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
                    });
                });
                throw dbErr;
            }
        } catch (error) {
            if (error instanceof Error && error.message === 'INVALID_ENTITY') {
                return res.status(400).json({ success: false, error: 'Linked entity not found' });
            }
            if (error instanceof StorageError) {
                logger.warn('documents.upload_storage_failed', {
                    code: error.code,
                    message: error.message,
                });
                return res.status(error.status).json({ success: false, error: error.toJSON() });
            }
            logger.error('documents.upload_unexpected', {
                error: error instanceof Error ? error.message : String(error),
            });
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

// ---------- GET /  (list with filters) ----------

router.get('/', validate({ query: documentListQuerySchema }), async (req: AuthRequest, res) => {
    try {
        const { entity_type, entity_id, category, q, unlinked } = req.query as {
            entity_type?: string;
            entity_id?: string;
            category?: string;
            q?: string;
            unlinked?: boolean;
        };
        const params: any[] = [req.userId];
        let sql = 'SELECT * FROM house_documents WHERE user_id = $1';
        if (entity_type && entity_id && isEntityType(entity_type)) {
            params.push(entity_id);
            sql += ` AND ${ENTITY_COLUMN[entity_type]} = $${params.length}`;
        }
        if (unlinked === true) {
            sql += ` AND equipment_id IS NULL
                         AND contract_id IS NULL
                         AND contact_id IS NULL
                         AND item_id IS NULL
                         AND project_id IS NULL`;
        }
        if (category) {
            params.push(category);
            sql += ` AND category = $${params.length}`;
        }
        if (q) {
            params.push(`%${q}%`);
            sql += ` AND (name ILIKE $${params.length}
                              OR file_name ILIKE $${params.length}
                              OR notes ILIKE $${params.length})`;
        }
        sql += ' ORDER BY created_at DESC';
        const r = await query(sql, params);
        res.json({ success: true, data: r.rows.map(mapDocument) });
    } catch (error) {
        logger.error('documents.list_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ---------- GET /:id (metadata only) ----------

router.get('/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query('SELECT * FROM house_documents WHERE id = $1 AND user_id = $2', [
            req.params.id,
            req.userId,
        ]);
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Document not found' });
        }
        res.json({ success: true, data: mapDocument(r.rows[0]) });
    } catch (error) {
        logger.error('documents.get_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ---------- GET /:id/file (proxy stream from MinIO) ----------

router.get('/:id/file', async (req: AuthRequest, res) => {
    try {
        const meta = await query(
            'SELECT storage_key, file_name, mime_type FROM house_documents WHERE id = $1 AND user_id = $2',
            [req.params.id, req.userId],
        );
        if (meta.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Document not found' });
        }
        const { storage_key, file_name, mime_type } = meta.rows[0] as {
            storage_key: string;
            file_name: string;
            mime_type: string;
        };

        const obj = await getObjectStream(storage_key);
        // `?download=1` → force download, otherwise inline so PDF/images
        // preview directly in the browser tab.
        const disposition = req.query.download === '1' ? 'attachment' : 'inline';
        // Filename* in RFC 5987 format to support non-ASCII (UTF-8) safely.
        const safeFilename = file_name.replace(/["\\]/g, '');
        res.setHeader('Content-Type', obj.contentType ?? mime_type);
        if (obj.contentLength) {
            res.setHeader('Content-Length', String(obj.contentLength));
        }
        res.setHeader(
            'Content-Disposition',
            `${disposition}; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(
                file_name,
            )}`,
        );
        // Cache: private (auth-gated) + short TTL so repeated previews are
        // snappy without going stale on edits.
        res.setHeader('Cache-Control', 'private, max-age=60');

        obj.body.on('error', (err) => {
            logger.error('documents.stream_body_error', {
                error: err instanceof Error ? err.message : String(err),
            });
            // We've already started writing — destroy the response so the
            // client sees a broken pipe rather than a hung connection.
            res.destroy(err instanceof Error ? err : new Error('Stream error'));
        });
        obj.body.pipe(res);
    } catch (error) {
        if (error instanceof StorageError && error.code === 'NOT_FOUND') {
            // The DB row exists but the S3 object is gone. Surface as 404
            // so the client can offer "delete the orphaned record".
            return res.status(404).json({ success: false, error: 'File missing in storage' });
        }
        if (error instanceof StorageError) {
            return res.status(error.status).json({ success: false, error: error.toJSON() });
        }
        logger.error('documents.stream_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ---------- PATCH /:id ----------

router.patch('/:id', validate({ body: documentPatchSchema }), async (req: AuthRequest, res) => {
    try {
        const updates: string[] = [];
        const values: any[] = [];
        const push = (col: string, val: any) => {
            values.push(val);
            updates.push(`${col} = $${values.length}`);
        };
        if (req.body.name !== undefined) push('name', req.body.name);
        if (req.body.category !== undefined) push('category', req.body.category);
        if (req.body.notes !== undefined) push('notes', req.body.notes);

        // Link change: clear all five then set the chosen one. The CHECK
        // constraint protects against accidental double-set.
        if (req.body.entity_type !== undefined) {
            const t = req.body.entity_type as EntityType | null;
            const id = req.body.entity_id as string | null;
            if (t && id) {
                await ensureEntityBelongsToUser(t, id, req.userId!);
            }
            // Reset all link columns first.
            for (const col of Object.values(ENTITY_COLUMN)) push(col, null);
            if (t && id) {
                push(ENTITY_COLUMN[t], id);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        values.push(req.params.id, req.userId);
        const r = await query(
            `UPDATE house_documents SET ${updates.join(', ')}
                 WHERE id = $${values.length - 1} AND user_id = $${values.length}
                 RETURNING *`,
            values,
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Document not found' });
        }
        res.json({ success: true, data: mapDocument(r.rows[0]) });
    } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_ENTITY') {
            return res.status(400).json({ success: false, error: 'Linked entity not found' });
        }
        logger.error('documents.update_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ---------- DELETE /:id ----------

router.delete('/:id', async (req: AuthRequest, res) => {
    try {
        // Read storage_key first so we can clean up S3 even if the row
        // disappears between SELECT and DELETE (it won't with single user
        // mutating, but keep the contract clean).
        const meta = await query(
            'SELECT storage_key FROM house_documents WHERE id = $1 AND user_id = $2',
            [req.params.id, req.userId],
        );
        if (meta.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Document not found' });
        }
        const storageKey = meta.rows[0].storage_key as string;

        // Delete S3 object first. If S3 fails we keep the DB row → user
        // can retry. If S3 succeeds but DB delete fails we'd have an
        // orphan row pointing to a missing object: the GET /:id/file
        // already handles that (returns 404 + "File missing in storage").
        await deleteObject(storageKey);
        await query('DELETE FROM house_documents WHERE id = $1 AND user_id = $2', [
            req.params.id,
            req.userId,
        ]);
        res.json({ success: true });
    } catch (error) {
        if (error instanceof StorageError) {
            return res.status(error.status).json({ success: false, error: error.toJSON() });
        }
        logger.error('documents.delete_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
