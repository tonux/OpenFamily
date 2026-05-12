import { z } from 'zod';

// =============================================================================
// Document schemas
//
// Used by /api/documents. Upload bodies are NOT validated with these schemas
// because multer parses the multipart and exposes form fields on req.body
// after the fact — we validate inline in the route. These schemas cover the
// JSON-only paths (PATCH, list query).
// =============================================================================

export const DOCUMENT_CATEGORIES = [
    'Facture',
    'Contrat',
    'Manuel',
    'Notice',
    'Photo',
    'Garantie',
    'Attestation',
    'Autre',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

// MIME allowlist enforced server-side. Browsers can be tricked into
// reporting wrong types but we'll accept whatever multer reports here and
// rely on Content-Type sniffing on serve. Tight enough to keep sketchy
// .exe / .sh out.
export const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/msword', // legacy .doc
    'application/vnd.ms-excel', // legacy .xls
    'text/plain',
] as const;
export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

export const ENTITY_TYPES = ['equipment', 'contract', 'contact', 'item', 'project'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

// Maps entity_type to the column we set on house_documents. Centralised
// so handlers can't drift.
export const ENTITY_COLUMN: Record<EntityType, string> = {
    equipment: 'equipment_id',
    contract: 'contract_id',
    contact: 'contact_id',
    item: 'item_id',
    project: 'project_id',
};

const optionalString = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .or(z.literal(''))
        .nullish()
        .transform((v) => (v === undefined || v === null || v === '' ? null : v));

export const documentPatchSchema = z
    .object({
        name: z.string().trim().min(1).max(200).optional(),
        category: z.enum(DOCUMENT_CATEGORIES).optional(),
        notes: optionalString(2000).optional(),
        entity_type: z.enum(ENTITY_TYPES).nullable().optional(),
        entity_id: z.string().uuid().nullable().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })
    // entity_type and entity_id must be provided together (or both null/undefined)
    .refine(
        (v) => {
            const t = v.entity_type;
            const i = v.entity_id;
            if (t === undefined && i === undefined) return true;
            // Both null = explicit "détache"
            if (t === null && i === null) return true;
            // Both set = link
            if (t && i) return true;
            return false;
        },
        { message: 'entity_type and entity_id must be provided together (or both null)' },
    );

export const documentListQuerySchema = z
    .object({
        entity_type: z.enum(ENTITY_TYPES).optional(),
        entity_id: z.string().uuid().optional(),
        category: z.enum(DOCUMENT_CATEGORIES).optional(),
        q: z.string().trim().min(1).max(200).optional(),
        // "true" → only documents with no link target.
        unlinked: z
            .union([z.literal('true'), z.literal('false')])
            .optional()
            .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
    })
    .strict()
    .refine(
        (v) =>
            (v.entity_type === undefined && v.entity_id === undefined) ||
            (v.entity_type !== undefined && v.entity_id !== undefined),
        { message: 'entity_type and entity_id must be provided together' },
    );

export type DocumentPatch = z.infer<typeof documentPatchSchema>;
