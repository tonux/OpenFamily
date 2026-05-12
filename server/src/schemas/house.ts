import { z } from 'zod';

// =============================================================================
// House schemas — equipments + maintenance.
// Mirrors the look-and-feel of schemas/auth.ts and schemas/ai.ts: zod enum
// for restricted fields, .strict() to reject unknown keys, ISO date strings
// kept as strings (the route layer hands them straight to Postgres).
// =============================================================================

export const EQUIPMENT_CATEGORIES = [
    'Chaudière',
    'Climatisation',
    'Électroménager',
    'Véhicule',
    'Outillage',
    'Sécurité',
    'Jardin',
    'Autre',
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const MAINTENANCE_KINDS = ['Entretien', 'Révision', 'Réparation', 'Inspection'] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Expected YYYY-MM-DD' });

const optionalNullable = <T extends z.ZodTypeAny>(schema: T) =>
    schema.nullish().transform((v) => (v === undefined ? undefined : v));

const optionalString = (max: number) =>
    optionalNullable(z.string().trim().max(max).or(z.literal('')))
        // Coerce empty strings to null so the DB stays clean.
        .transform((v) => (typeof v === 'string' && v.length === 0 ? null : v));

// ---------- Equipment ----------

export const equipmentBodySchema = z
    .object({
        name: z.string().trim().min(1).max(120),
        category: z.enum(EQUIPMENT_CATEGORIES),
        brand: optionalString(80),
        model: optionalString(80),
        serial_number: optionalString(80),
        purchase_date: optionalNullable(isoDate),
        purchase_price: optionalNullable(z.number().min(0).max(10_000_000)),
        warranty_until: optionalNullable(isoDate),
        location_room: optionalString(60),
        image_url: optionalString(2048),
        notes: optionalString(2000),
    })
    .strict();

// PATCH: every field optional but the same constraints when present. Avoid
// .partial() because it would also drop the strict-key check on nested
// transforms, so we redeclare the shape with `.optional()` wrappers.
export const equipmentPatchSchema = z
    .object({
        name: z.string().trim().min(1).max(120).optional(),
        category: z.enum(EQUIPMENT_CATEGORIES).optional(),
        brand: optionalString(80).optional(),
        model: optionalString(80).optional(),
        serial_number: optionalString(80).optional(),
        purchase_date: optionalNullable(isoDate).optional(),
        purchase_price: optionalNullable(z.number().min(0).max(10_000_000)).optional(),
        warranty_until: optionalNullable(isoDate).optional(),
        location_room: optionalString(60).optional(),
        image_url: optionalString(2048).optional(),
        notes: optionalString(2000).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

// ---------- Maintenance ----------

const maintenanceCommonShape = {
    title: z.string().trim().min(1).max(120),
    kind: z.enum(MAINTENANCE_KINDS),
    planned_date: optionalNullable(isoDate),
    performed_date: optionalNullable(isoDate),
    cost: optionalNullable(z.number().min(0).max(10_000_000)),
    recurrence_months: optionalNullable(z.number().int().min(1).max(120)),
    notes: optionalString(2000),
};

const datesPresentRefine = <T extends { planned_date?: unknown; performed_date?: unknown }>(v: T) =>
    v.planned_date != null || v.performed_date != null;

export const maintenanceBodySchema = z
    .object({
        equipment_id: z.string().uuid(),
        ...maintenanceCommonShape,
    })
    .strict()
    .refine(datesPresentRefine, {
        message: 'Either planned_date or performed_date must be set',
        path: ['planned_date'],
    });

export const maintenancePatchSchema = z
    .object({
        title: maintenanceCommonShape.title.optional(),
        kind: maintenanceCommonShape.kind.optional(),
        planned_date: maintenanceCommonShape.planned_date.optional(),
        performed_date: maintenanceCommonShape.performed_date.optional(),
        cost: maintenanceCommonShape.cost.optional(),
        recurrence_months: maintenanceCommonShape.recurrence_months.optional(),
        notes: maintenanceCommonShape.notes.optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

// Query string for listing maintenance.
export const maintenanceListQuerySchema = z
    .object({
        equipment_id: z.string().uuid().optional(),
        status: z.enum(['upcoming', 'done', 'all']).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
    })
    .strict();

export const equipmentListQuerySchema = z
    .object({
        category: z.enum(EQUIPMENT_CATEGORIES).optional(),
        q: z.string().trim().min(1).max(120).optional(),
    })
    .strict();

export type EquipmentBody = z.infer<typeof equipmentBodySchema>;
export type EquipmentPatch = z.infer<typeof equipmentPatchSchema>;
export type MaintenanceBody = z.infer<typeof maintenanceBodySchema>;
export type MaintenancePatch = z.infer<typeof maintenancePatchSchema>;

// ---------- Contracts ----------

export const CONTRACT_CATEGORIES = [
    'Énergie',
    'Eau',
    'Internet',
    'Téléphone',
    'Streaming',
    'Assurance',
    'Prêt',
    'Abonnement',
    'Autre',
] as const;
export type ContractCategory = (typeof CONTRACT_CATEGORIES)[number];

export const CONTRACT_FREQUENCIES = [
    'Mensuel',
    'Bimestriel',
    'Trimestriel',
    'Semestriel',
    'Annuel',
] as const;
export type ContractFrequency = (typeof CONTRACT_FREQUENCIES)[number];

export const PAYMENT_METHODS = [
    'Prélèvement auto',
    'Carte',
    'Virement',
    'Chèque',
    'Espèces',
    'Manuel',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const contractBodySchema = z
    .object({
        name: z.string().trim().min(1).max(120),
        provider: optionalString(80),
        category: z.enum(CONTRACT_CATEGORIES),
        amount: z.number().min(0).max(10_000_000),
        frequency: z.enum(CONTRACT_FREQUENCIES),
        next_due_date: isoDate,
        payment_method: z.enum(PAYMENT_METHODS).optional(),
        client_number: optionalString(80),
        notes: optionalString(2000),
        is_active: z.boolean().optional(),
        auto_create_budget_entry: z.boolean().optional(),
        budget_category: optionalString(50),
    })
    .strict();

export const contractPatchSchema = z
    .object({
        name: z.string().trim().min(1).max(120).optional(),
        provider: optionalString(80).optional(),
        category: z.enum(CONTRACT_CATEGORIES).optional(),
        amount: z.number().min(0).max(10_000_000).optional(),
        frequency: z.enum(CONTRACT_FREQUENCIES).optional(),
        next_due_date: isoDate.optional(),
        payment_method: z.enum(PAYMENT_METHODS).optional(),
        client_number: optionalString(80).optional(),
        notes: optionalString(2000).optional(),
        is_active: z.boolean().optional(),
        auto_create_budget_entry: z.boolean().optional(),
        budget_category: optionalString(50).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const contractListQuerySchema = z
    .object({
        status: z.enum(['active', 'inactive', 'all']).optional(),
    })
    .strict();

// "Mark as paid" payload. All optional: defaults to today + contract amount,
// and respects the contract's auto_create_budget_entry flag unless overridden.
export const contractPayBodySchema = z
    .object({
        paid_date: isoDate.optional(),
        amount_actual: z.number().min(0).max(10_000_000).optional(),
        create_budget_entry: z.boolean().optional(),
    })
    .strict();

export type ContractBody = z.infer<typeof contractBodySchema>;
export type ContractPatch = z.infer<typeof contractPatchSchema>;
export type ContractPayBody = z.infer<typeof contractPayBodySchema>;

// ---------- Contacts ----------

export const CONTACT_CATEGORIES = [
    'Plombier',
    'Électricien',
    'Chauffagiste',
    'Bricoleur',
    'Jardinier',
    'Ménage',
    'Médecin',
    'Pédiatre',
    'Vétérinaire',
    'Gardien',
    'Voisin',
    'Famille',
    'Urgences',
    'Assurance',
    'Banque',
    'École',
    'Autre',
] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

// Loose phone validation: keep digits, +, spaces, dashes, parentheses, dots.
// Don't enforce a country format — it would only help PRO users and break
// for half the planet.
const phoneSchema = z
    .string()
    .trim()
    .max(40)
    .regex(/^[+0-9()\-.\s]+$/, { message: 'Phone contains invalid characters' });

export const contactBodySchema = z
    .object({
        name: z.string().trim().min(1).max(120),
        category: z.enum(CONTACT_CATEGORIES),
        company: optionalString(120),
        phone: phoneSchema
            .optional()
            .nullable()
            .or(z.literal('').transform(() => null)),
        email: z
            .string()
            .trim()
            .max(255)
            .email({ message: 'Invalid email' })
            .optional()
            .nullable()
            .or(z.literal('').transform(() => null)),
        address: optionalString(500),
        notes: optionalString(2000),
        last_intervention_date: optionalNullable(isoDate),
        is_favorite: z.boolean().optional(),
        equipment_id: z.string().uuid().nullable().optional(),
    })
    .strict();

export const contactPatchSchema = z
    .object({
        name: z.string().trim().min(1).max(120).optional(),
        category: z.enum(CONTACT_CATEGORIES).optional(),
        company: optionalString(120).optional(),
        phone: phoneSchema
            .optional()
            .nullable()
            .or(z.literal('').transform(() => null)),
        email: z
            .string()
            .trim()
            .max(255)
            .email({ message: 'Invalid email' })
            .optional()
            .nullable()
            .or(z.literal('').transform(() => null)),
        address: optionalString(500).optional(),
        notes: optionalString(2000).optional(),
        last_intervention_date: optionalNullable(isoDate).optional(),
        is_favorite: z.boolean().optional(),
        equipment_id: z.string().uuid().nullable().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const contactListQuerySchema = z
    .object({
        category: z.enum(CONTACT_CATEGORIES).optional(),
        q: z.string().trim().min(1).max(120).optional(),
        equipment_id: z.string().uuid().optional(),
    })
    .strict();

export type ContactBody = z.infer<typeof contactBodySchema>;
export type ContactPatch = z.infer<typeof contactPatchSchema>;

// ---------- Rooms (Phase 4) ----------

export const ROOM_CATEGORIES = [
    'Salon',
    'Cuisine',
    'Salle à manger',
    'Chambre',
    'Chambre enfant',
    'Salle de bain',
    'WC',
    'Bureau',
    'Buanderie',
    'Garage',
    'Cave',
    'Grenier',
    'Atelier',
    'Jardin',
    'Terrasse',
    'Couloir',
    'Entrée',
    'Autre',
] as const;
export type RoomCategory = (typeof ROOM_CATEGORIES)[number];

const hexColor = z
    .string()
    .trim()
    .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, { message: 'Expected hex color' });

export const roomBodySchema = z
    .object({
        name: z.string().trim().min(1).max(80),
        category: z.enum(ROOM_CATEGORIES),
        color: hexColor.optional(),
        notes: optionalString(2000),
    })
    .strict();

export const roomPatchSchema = z
    .object({
        name: z.string().trim().min(1).max(80).optional(),
        category: z.enum(ROOM_CATEGORIES).optional(),
        color: hexColor.optional(),
        notes: optionalString(2000).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

// ---------- Items (Phase 4) ----------

export const ITEM_CATEGORIES = [
    'Outils',
    'Documents',
    'Médicaments',
    'Électronique',
    'Papeterie',
    'Vêtements',
    'Cuisine',
    'Décoration',
    'Jouets',
    'Sport',
    'Saisonnier',
    'Autre',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const itemBodySchema = z
    .object({
        name: z.string().trim().min(1).max(120),
        category: z.enum(ITEM_CATEGORIES),
        room_id: z.string().uuid().nullable().optional(),
        quantity: z.number().int().min(1).max(99_999).optional().nullable(),
        location_detail: optionalString(120),
        photo_url: optionalString(2048),
        notes: optionalString(2000),
    })
    .strict();

export const itemPatchSchema = z
    .object({
        name: z.string().trim().min(1).max(120).optional(),
        category: z.enum(ITEM_CATEGORIES).optional(),
        room_id: z.string().uuid().nullable().optional(),
        quantity: z.number().int().min(1).max(99_999).optional().nullable(),
        location_detail: optionalString(120).optional(),
        photo_url: optionalString(2048).optional(),
        notes: optionalString(2000).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const itemListQuerySchema = z
    .object({
        room_id: z.string().uuid().optional(),
        category: z.enum(ITEM_CATEGORIES).optional(),
        // `q` is used by the "Où est X ?" search across all rooms.
        q: z.string().trim().min(1).max(120).optional(),
        // Bare flag for orphans (items without a room) — useful for the
        // "À ranger" pile after a room delete.
        orphan: z
            .union([z.literal('true'), z.literal('false')])
            .optional()
            .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
    })
    .strict();

// Bulk move endpoint payload — efficient for the user gathering several
// items into a new room (or to "À ranger" with room_id=null).
export const itemsMoveBodySchema = z
    .object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        room_id: z.string().uuid().nullable(),
    })
    .strict();

export type RoomBody = z.infer<typeof roomBodySchema>;
export type RoomPatch = z.infer<typeof roomPatchSchema>;
export type ItemBody = z.infer<typeof itemBodySchema>;
export type ItemPatch = z.infer<typeof itemPatchSchema>;
export type ItemsMoveBody = z.infer<typeof itemsMoveBodySchema>;

// ---------- Projects (Phase 5) ----------

export const PROJECT_CATEGORIES = [
    'Rénovation',
    'Décoration',
    'Jardin',
    'Sécurité',
    'Confort',
    'Réparation',
    'Énergie',
    'Mobilier',
    'Autre',
] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export const PROJECT_STATUSES = ['Idée', 'En cours', 'Terminé', 'Suspendu'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

const checklistItemSchema = z
    .object({
        id: z.string().uuid(),
        label: z.string().trim().min(1).max(200),
        done: z.boolean(),
    })
    .strict();

const checklistSchema = z.array(checklistItemSchema).max(30);

export const projectBodySchema = z
    .object({
        name: z.string().trim().min(1).max(120),
        category: z.enum(PROJECT_CATEGORIES),
        status: z.enum(PROJECT_STATUSES).optional(),
        description: optionalString(4000),
        planned_budget: z.number().min(0).max(100_000_000).optional().nullable(),
        started_at: optionalNullable(isoDate),
        target_end: optionalNullable(isoDate),
        completed_at: optionalNullable(isoDate),
        checklist: checklistSchema.optional(),
        notes: optionalString(2000),
    })
    .strict();

export const projectPatchSchema = z
    .object({
        name: z.string().trim().min(1).max(120).optional(),
        category: z.enum(PROJECT_CATEGORIES).optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
        description: optionalString(4000).optional(),
        planned_budget: z.number().min(0).max(100_000_000).optional().nullable(),
        started_at: optionalNullable(isoDate).optional(),
        target_end: optionalNullable(isoDate).optional(),
        completed_at: optionalNullable(isoDate).optional(),
        checklist: checklistSchema.optional(),
        notes: optionalString(2000).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const projectListQuerySchema = z
    .object({
        status: z.enum(PROJECT_STATUSES).optional(),
    })
    .strict();

// Atomic checklist operations — server applies them inside a transaction so
// concurrent edits from two tabs don't clobber each other.
export const checklistOpSchema = z.discriminatedUnion('op', [
    z
        .object({
            op: z.literal('add'),
            label: z.string().trim().min(1).max(200),
        })
        .strict(),
    z
        .object({
            op: z.literal('toggle'),
            id: z.string().uuid(),
        })
        .strict(),
    z
        .object({
            op: z.literal('rename'),
            id: z.string().uuid(),
            label: z.string().trim().min(1).max(200),
        })
        .strict(),
    z
        .object({
            op: z.literal('remove'),
            id: z.string().uuid(),
        })
        .strict(),
    z
        .object({
            op: z.literal('reorder'),
            ids: z.array(z.string().uuid()).max(30),
        })
        .strict(),
]);

export type ProjectBody = z.infer<typeof projectBodySchema>;
export type ProjectPatch = z.infer<typeof projectPatchSchema>;
export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type ChecklistOp = z.infer<typeof checklistOpSchema>;
