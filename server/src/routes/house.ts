import { Router } from 'express';
import { getClient, query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
    checklistOpSchema,
    contactBodySchema,
    contactListQuerySchema,
    contactPatchSchema,
    contractBodySchema,
    contractListQuerySchema,
    contractPatchSchema,
    contractPayBodySchema,
    equipmentBodySchema,
    equipmentListQuerySchema,
    equipmentPatchSchema,
    itemBodySchema,
    itemListQuerySchema,
    itemPatchSchema,
    itemsMoveBodySchema,
    maintenanceBodySchema,
    maintenanceListQuerySchema,
    maintenancePatchSchema,
    projectBodySchema,
    projectListQuerySchema,
    projectPatchSchema,
    roomBodySchema,
    roomPatchSchema,
    type ChecklistItem,
    type ChecklistOp,
} from '../schemas/house';
import { randomUUID } from 'crypto';
import logger from '../lib/logger';

// Maps each contract frequency to a Postgres interval expression — used both
// when "marking as paid" (advance next_due_date) and when computing the
// monthly-equivalent amount for the dashboard summary.
const CONTRACT_INTERVAL: Record<string, string> = {
    Mensuel: '1 month',
    Bimestriel: '2 months',
    Trimestriel: '3 months',
    Semestriel: '6 months',
    Annuel: '1 year',
};

// Number of months a frequency represents — for the "estimated monthly cost"
// aggregate on the dashboard.
const FREQUENCY_MONTHS: Record<string, number> = {
    Mensuel: 1,
    Bimestriel: 2,
    Trimestriel: 3,
    Semestriel: 6,
    Annuel: 12,
};

// =============================================================================
// /api/house — Phase 1 of the "Maison" section
//
// Two resources, both auth-gated and scoped to the calling user:
//   - house_equipments  — inventory (boiler, fridge, car, …)
//   - house_maintenance — log book + planned interventions, FK to equipment
//
// Plus one read-only aggregator used by the dashboard widget.
//
// Recurrence policy: when a maintenance row gets its `performed_date` set
// (PATCH transitioning NULL → date) AND has a non-null `recurrence_months`,
// the route inserts a fresh planned occurrence at performed_date + N months
// inside the same transaction, copying title/kind/recurrence. We never
// duplicate-fire because the trigger only happens on the NULL→value
// transition.
// =============================================================================

const router = Router();
router.use(authMiddleware);

const ensureEquipmentBelongsToUser = async (equipmentId: string, userId: string): Promise<void> => {
    const r = await query('SELECT id FROM house_equipments WHERE id = $1 AND user_id = $2', [
        equipmentId,
        userId,
    ]);
    if (r.rows.length === 0) throw new Error('INVALID_EQUIPMENT');
};

const mapEquipment = (row: any) => ({
    id: row.id as string,
    name: row.name as string,
    category: row.category as string,
    brand: row.brand ?? null,
    model: row.model ?? null,
    serial_number: row.serial_number ?? null,
    purchase_date: row.purchase_date ?? null,
    purchase_price: row.purchase_price !== null ? Number(row.purchase_price) : null,
    warranty_until: row.warranty_until ?? null,
    location_room: row.location_room ?? null,
    image_url: row.image_url ?? null,
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

const mapMaintenance = (row: any) => ({
    id: row.id as string,
    equipment_id: row.equipment_id as string,
    title: row.title as string,
    kind: row.kind as string,
    planned_date: row.planned_date ?? null,
    performed_date: row.performed_date ?? null,
    cost: row.cost !== null ? Number(row.cost) : null,
    recurrence_months: row.recurrence_months ?? null,
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // When joined with equipment in dashboard responses.
    equipment_name: row.equipment_name ?? undefined,
    equipment_category: row.equipment_category ?? undefined,
});

// ---------------------------------------------------------------------------
// Equipments
// ---------------------------------------------------------------------------

router.get(
    '/equipments',
    validate({ query: equipmentListQuerySchema }),
    async (req: AuthRequest, res) => {
        try {
            const { category, q } = req.query as { category?: string; q?: string };
            const params: any[] = [req.userId];
            let sql = 'SELECT * FROM house_equipments WHERE user_id = $1';
            if (category) {
                params.push(category);
                sql += ` AND category = $${params.length}`;
            }
            if (q) {
                params.push(`%${q}%`);
                sql += ` AND (name ILIKE $${params.length} OR brand ILIKE $${params.length} OR model ILIKE $${params.length})`;
            }
            sql += ' ORDER BY name ASC';
            const r = await query(sql, params);
            res.json({ success: true, data: r.rows.map(mapEquipment) });
        } catch (error) {
            logger.error('house.list_equipments_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

router.post(
    '/equipments',
    validate({ body: equipmentBodySchema }),
    async (req: AuthRequest, res) => {
        try {
            const b = req.body;
            const r = await query(
                `INSERT INTO house_equipments
                    (user_id, name, category, brand, model, serial_number,
                     purchase_date, purchase_price, warranty_until,
                     location_room, image_url, notes)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                 RETURNING *`,
                [
                    req.userId,
                    b.name,
                    b.category,
                    b.brand ?? null,
                    b.model ?? null,
                    b.serial_number ?? null,
                    b.purchase_date ?? null,
                    b.purchase_price ?? null,
                    b.warranty_until ?? null,
                    b.location_room ?? null,
                    b.image_url ?? null,
                    b.notes ?? null,
                ],
            );
            res.status(201).json({ success: true, data: mapEquipment(r.rows[0]) });
        } catch (error) {
            logger.error('house.create_equipment_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

router.get('/equipments/:id', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const eq = await query('SELECT * FROM house_equipments WHERE id = $1 AND user_id = $2', [
            id,
            req.userId,
        ]);
        if (eq.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Equipment not found' });
        }
        // Embed last 5 maintenance + count of upcoming for the detail panel —
        // saves a round-trip when opening the equipment page.
        const recent = await query(
            `SELECT * FROM house_maintenance
             WHERE equipment_id = $1
             ORDER BY COALESCE(performed_date, planned_date) DESC NULLS LAST
             LIMIT 5`,
            [id],
        );
        const upcoming = await query(
            `SELECT COUNT(*) AS c FROM house_maintenance
             WHERE equipment_id = $1 AND planned_date IS NOT NULL AND planned_date >= CURRENT_DATE`,
            [id],
        );
        res.json({
            success: true,
            data: {
                ...mapEquipment(eq.rows[0]),
                recent_maintenance: recent.rows.map(mapMaintenance),
                upcoming_count: Number(upcoming.rows[0].c),
            },
        });
    } catch (error) {
        logger.error('house.get_equipment_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.patch(
    '/equipments/:id',
    validate({ body: equipmentPatchSchema }),
    async (req: AuthRequest, res) => {
        try {
            const { id } = req.params;
            const updates: string[] = [];
            const values: any[] = [];
            const push = (col: string, val: any) => {
                values.push(val);
                updates.push(`${col} = $${values.length}`);
            };
            for (const [k, v] of Object.entries(req.body)) {
                if (v === undefined) continue;
                push(k, v);
            }
            if (updates.length === 0) {
                return res.status(400).json({ success: false, error: 'No fields to update' });
            }
            values.push(id, req.userId);
            const r = await query(
                `UPDATE house_equipments SET ${updates.join(', ')}
                 WHERE id = $${values.length - 1} AND user_id = $${values.length}
                 RETURNING *`,
                values,
            );
            if (r.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Equipment not found' });
            }
            res.json({ success: true, data: mapEquipment(r.rows[0]) });
        } catch (error) {
            logger.error('house.update_equipment_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

router.delete('/equipments/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            'DELETE FROM house_equipments WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Equipment not found' });
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('house.delete_equipment_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

router.get(
    '/maintenance',
    validate({ query: maintenanceListQuerySchema }),
    async (req: AuthRequest, res) => {
        try {
            const { equipment_id, status, from, to } = req.query as {
                equipment_id?: string;
                status?: 'upcoming' | 'done' | 'all';
                from?: string;
                to?: string;
            };
            const params: any[] = [req.userId];
            let sql = `SELECT m.*, e.name as equipment_name, e.category as equipment_category
                       FROM house_maintenance m
                       JOIN house_equipments e ON m.equipment_id = e.id
                       WHERE m.user_id = $1`;
            if (equipment_id) {
                params.push(equipment_id);
                sql += ` AND m.equipment_id = $${params.length}`;
            }
            const effectiveStatus = status ?? 'upcoming';
            if (effectiveStatus === 'upcoming') {
                sql += ' AND m.planned_date IS NOT NULL AND m.planned_date >= CURRENT_DATE';
            } else if (effectiveStatus === 'done') {
                sql += ' AND m.performed_date IS NOT NULL';
            }
            if (from) {
                params.push(from);
                sql += ` AND COALESCE(m.planned_date, m.performed_date) >= $${params.length}`;
            }
            if (to) {
                params.push(to);
                sql += ` AND COALESCE(m.planned_date, m.performed_date) <= $${params.length}`;
            }
            sql +=
                effectiveStatus === 'done'
                    ? ' ORDER BY m.performed_date DESC'
                    : ' ORDER BY m.planned_date ASC NULLS LAST, m.performed_date DESC';
            const r = await query(sql, params);
            res.json({ success: true, data: r.rows.map(mapMaintenance) });
        } catch (error) {
            logger.error('house.list_maintenance_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

router.post(
    '/maintenance',
    validate({ body: maintenanceBodySchema }),
    async (req: AuthRequest, res) => {
        try {
            const b = req.body;
            await ensureEquipmentBelongsToUser(b.equipment_id, req.userId!);
            const r = await query(
                `INSERT INTO house_maintenance
                    (user_id, equipment_id, title, kind, planned_date,
                     performed_date, cost, recurrence_months, notes)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 RETURNING *`,
                [
                    req.userId,
                    b.equipment_id,
                    b.title,
                    b.kind,
                    b.planned_date ?? null,
                    b.performed_date ?? null,
                    b.cost ?? null,
                    b.recurrence_months ?? null,
                    b.notes ?? null,
                ],
            );
            res.status(201).json({ success: true, data: mapMaintenance(r.rows[0]) });
        } catch (error) {
            if (error instanceof Error && error.message === 'INVALID_EQUIPMENT') {
                return res.status(400).json({ success: false, error: 'Equipment not found' });
            }
            logger.error('house.create_maintenance_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

router.patch(
    '/maintenance/:id',
    validate({ body: maintenancePatchSchema }),
    async (req: AuthRequest, res) => {
        const client = await getClient();
        try {
            await client.query('BEGIN');

            // Read the current row to detect the NULL→value transition on
            // performed_date. Lock it for update so two concurrent PATCHes
            // can't race into double-creating the next occurrence.
            const before = await client.query(
                'SELECT * FROM house_maintenance WHERE id = $1 AND user_id = $2 FOR UPDATE',
                [req.params.id, req.userId],
            );
            if (before.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Maintenance not found' });
            }
            const previous = before.rows[0];

            const updates: string[] = [];
            const values: any[] = [];
            const push = (col: string, val: any) => {
                values.push(val);
                updates.push(`${col} = $${values.length}`);
            };
            for (const [k, v] of Object.entries(req.body)) {
                if (v === undefined) continue;
                push(k, v);
            }
            if (updates.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'No fields to update' });
            }
            values.push(req.params.id, req.userId);
            const after = await client.query(
                `UPDATE house_maintenance SET ${updates.join(', ')}
                 WHERE id = $${values.length - 1} AND user_id = $${values.length}
                 RETURNING *`,
                values,
            );
            const updated = after.rows[0];

            // Recurrence trigger: only fire when the row JUST got completed
            // and recurrence is set. Re-PATCH-ing performed_date on an
            // already-completed row does NOT create a duplicate.
            const justCompleted =
                previous.performed_date === null && updated.performed_date !== null;
            const recurrence = updated.recurrence_months;
            let createdNext: any = null;
            if (justCompleted && recurrence && recurrence > 0) {
                const next = await client.query(
                    `INSERT INTO house_maintenance
                        (user_id, equipment_id, title, kind, planned_date,
                         recurrence_months, notes)
                     VALUES ($1,$2,$3,$4,
                             ($5::date + ($6 || ' months')::interval)::date,
                             $6, $7)
                     RETURNING *`,
                    [
                        req.userId,
                        updated.equipment_id,
                        updated.title,
                        updated.kind,
                        updated.performed_date,
                        recurrence,
                        updated.notes ?? null,
                    ],
                );
                createdNext = next.rows[0];
            }

            await client.query('COMMIT');
            res.json({
                success: true,
                data: {
                    ...mapMaintenance(updated),
                    next_occurrence: createdNext ? mapMaintenance(createdNext) : null,
                },
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            logger.error('house.update_maintenance_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        } finally {
            client.release();
        }
    },
);

router.delete('/maintenance/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            'DELETE FROM house_maintenance WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Maintenance not found' });
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('house.delete_maintenance_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// Contracts (Phase 2)
// ---------------------------------------------------------------------------

const mapContract = (row: any) => ({
    id: row.id as string,
    name: row.name as string,
    provider: row.provider ?? null,
    category: row.category as string,
    amount: Number(row.amount),
    frequency: row.frequency as string,
    next_due_date: row.next_due_date,
    payment_method: row.payment_method ?? null,
    client_number: row.client_number ?? null,
    notes: row.notes ?? null,
    is_active: row.is_active as boolean,
    auto_create_budget_entry: row.auto_create_budget_entry as boolean,
    budget_category: row.budget_category ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

router.get(
    '/contracts',
    validate({ query: contractListQuerySchema }),
    async (req: AuthRequest, res) => {
        try {
            const status = (req.query as { status?: string }).status ?? 'active';
            const params: any[] = [req.userId];
            let sql = 'SELECT * FROM house_contracts WHERE user_id = $1';
            if (status === 'active') sql += ' AND is_active = true';
            else if (status === 'inactive') sql += ' AND is_active = false';
            sql += ' ORDER BY next_due_date ASC';
            const r = await query(sql, params);
            res.json({ success: true, data: r.rows.map(mapContract) });
        } catch (error) {
            logger.error('house.list_contracts_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

router.post('/contracts', validate({ body: contractBodySchema }), async (req: AuthRequest, res) => {
    try {
        const b = req.body;
        const r = await query(
            `INSERT INTO house_contracts
                    (user_id, name, provider, category, amount, frequency,
                     next_due_date, payment_method, client_number, notes,
                     is_active, auto_create_budget_entry, budget_category)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                         COALESCE($11, true),
                         COALESCE($12, true),
                         $13)
                 RETURNING *`,
            [
                req.userId,
                b.name,
                b.provider ?? null,
                b.category,
                b.amount,
                b.frequency,
                b.next_due_date,
                b.payment_method ?? null,
                b.client_number ?? null,
                b.notes ?? null,
                b.is_active ?? null,
                b.auto_create_budget_entry ?? null,
                b.budget_category ?? null,
            ],
        );
        res.status(201).json({ success: true, data: mapContract(r.rows[0]) });
    } catch (error) {
        logger.error('house.create_contract_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.patch(
    '/contracts/:id',
    validate({ body: contractPatchSchema }),
    async (req: AuthRequest, res) => {
        try {
            const updates: string[] = [];
            const values: any[] = [];
            const push = (col: string, val: any) => {
                values.push(val);
                updates.push(`${col} = $${values.length}`);
            };
            for (const [k, v] of Object.entries(req.body)) {
                if (v === undefined) continue;
                push(k, v);
            }
            if (updates.length === 0) {
                return res.status(400).json({ success: false, error: 'No fields to update' });
            }
            values.push(req.params.id, req.userId);
            const r = await query(
                `UPDATE house_contracts SET ${updates.join(', ')}
                 WHERE id = $${values.length - 1} AND user_id = $${values.length}
                 RETURNING *`,
                values,
            );
            if (r.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Contract not found' });
            }
            res.json({ success: true, data: mapContract(r.rows[0]) });
        } catch (error) {
            logger.error('house.update_contract_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

router.delete('/contracts/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            'DELETE FROM house_contracts WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Contract not found' });
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('house.delete_contract_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/house/contracts/:id/pay
 * Body: { paid_date?, amount_actual?, create_budget_entry? }
 *
 * Atomically: advances next_due_date by the contract's frequency interval
 * and (if `auto_create_budget_entry` or the explicit override is true)
 * inserts a row into budget_entries. Returns both the updated contract and
 * the created budget_entry id (if any) so the client can link to it.
 *
 * Idempotency note: this is intentionally NOT idempotent — calling it twice
 * legitimately means "I paid two periods at once". The user is the source
 * of truth on whether they've paid; we don't try to detect duplicates.
 */
router.post(
    '/contracts/:id/pay',
    validate({ body: contractPayBodySchema }),
    async (req: AuthRequest, res) => {
        const client = await getClient();
        try {
            await client.query('BEGIN');
            const before = await client.query(
                'SELECT * FROM house_contracts WHERE id = $1 AND user_id = $2 FOR UPDATE',
                [req.params.id, req.userId],
            );
            if (before.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Contract not found' });
            }
            const contract = before.rows[0];
            const interval = CONTRACT_INTERVAL[contract.frequency as string];
            if (!interval) {
                await client.query('ROLLBACK');
                return res
                    .status(400)
                    .json({ success: false, error: 'Unknown contract frequency' });
            }

            const paidDate = (req.body.paid_date as string | undefined) ?? null;
            const amount =
                req.body.amount_actual !== undefined
                    ? req.body.amount_actual
                    : Number(contract.amount);

            // Advance next_due_date by ONE interval, anchored on the current
            // next_due_date (preserves cadence even when the user pays late).
            const updated = await client.query(
                `UPDATE house_contracts
                    SET next_due_date = (next_due_date + interval '${interval}')::date
                  WHERE id = $1 AND user_id = $2
                  RETURNING *`,
                [req.params.id, req.userId],
            );

            // Decide whether to create a budget entry: explicit override on
            // the request wins; otherwise the contract-level flag.
            const wantsEntry =
                req.body.create_budget_entry !== undefined
                    ? Boolean(req.body.create_budget_entry)
                    : Boolean(contract.auto_create_budget_entry);

            let budgetEntryId: string | null = null;
            if (wantsEntry) {
                const category = (contract.budget_category as string | null) ?? 'Maison';
                const entry = await client.query(
                    `INSERT INTO budget_entries
                        (user_id, category, amount, description, date, is_expense)
                     VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), true)
                     RETURNING id`,
                    [
                        req.userId,
                        category,
                        amount,
                        `${contract.name}${contract.provider ? ` (${contract.provider})` : ''}`,
                        paidDate,
                    ],
                );
                budgetEntryId = entry.rows[0].id as string;
            }

            await client.query('COMMIT');
            res.json({
                success: true,
                data: {
                    contract: mapContract(updated.rows[0]),
                    budget_entry_id: budgetEntryId,
                    amount_paid: amount,
                },
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            logger.error('house.pay_contract_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        } finally {
            client.release();
        }
    },
);

// ---------------------------------------------------------------------------
// Contacts (Phase 3)
// ---------------------------------------------------------------------------

const mapContact = (row: any) => ({
    id: row.id as string,
    name: row.name as string,
    category: row.category as string,
    company: row.company ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    address: row.address ?? null,
    notes: row.notes ?? null,
    last_intervention_date: row.last_intervention_date ?? null,
    is_favorite: row.is_favorite as boolean,
    equipment_id: row.equipment_id ?? null,
    equipment_name: row.equipment_name ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

router.get(
    '/contacts',
    validate({ query: contactListQuerySchema }),
    async (req: AuthRequest, res) => {
        try {
            const { category, q, equipment_id } = req.query as {
                category?: string;
                q?: string;
                equipment_id?: string;
            };
            const params: any[] = [req.userId];
            // LEFT JOIN equipment so the UI can show "Chaudière" alongside the
            // chauffagiste without a second round-trip.
            let sql = `
                SELECT c.*, e.name as equipment_name
                FROM house_contacts c
                LEFT JOIN house_equipments e ON c.equipment_id = e.id
                WHERE c.user_id = $1`;
            if (category) {
                params.push(category);
                sql += ` AND c.category = $${params.length}`;
            }
            if (equipment_id) {
                params.push(equipment_id);
                sql += ` AND c.equipment_id = $${params.length}`;
            }
            if (q) {
                params.push(`%${q}%`);
                sql += ` AND (c.name ILIKE $${params.length}
                              OR c.company ILIKE $${params.length}
                              OR c.notes ILIKE $${params.length})`;
            }
            // Favourites first within each category, then alphabetical.
            sql += ' ORDER BY c.is_favorite DESC, c.category ASC, c.name ASC';
            const r = await query(sql, params);
            res.json({ success: true, data: r.rows.map(mapContact) });
        } catch (error) {
            logger.error('house.list_contacts_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

const ensureEquipmentBelongsToUserOrNull = async (
    equipmentId: string | null | undefined,
    userId: string,
): Promise<void> => {
    if (!equipmentId) return;
    await ensureEquipmentBelongsToUser(equipmentId, userId);
};

router.post('/contacts', validate({ body: contactBodySchema }), async (req: AuthRequest, res) => {
    try {
        const b = req.body;
        await ensureEquipmentBelongsToUserOrNull(b.equipment_id, req.userId!);
        const r = await query(
            `INSERT INTO house_contacts
                    (user_id, name, category, company, phone, email, address,
                     notes, last_intervention_date, is_favorite, equipment_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, false), $11)
                 RETURNING *`,
            [
                req.userId,
                b.name,
                b.category,
                b.company ?? null,
                b.phone ?? null,
                b.email ?? null,
                b.address ?? null,
                b.notes ?? null,
                b.last_intervention_date ?? null,
                b.is_favorite ?? null,
                b.equipment_id ?? null,
            ],
        );
        res.status(201).json({ success: true, data: mapContact(r.rows[0]) });
    } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_EQUIPMENT') {
            return res.status(400).json({ success: false, error: 'Equipment not found' });
        }
        logger.error('house.create_contact_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.patch(
    '/contacts/:id',
    validate({ body: contactPatchSchema }),
    async (req: AuthRequest, res) => {
        try {
            if (req.body.equipment_id !== undefined) {
                await ensureEquipmentBelongsToUserOrNull(req.body.equipment_id, req.userId!);
            }
            const updates: string[] = [];
            const values: any[] = [];
            const push = (col: string, val: any) => {
                values.push(val);
                updates.push(`${col} = $${values.length}`);
            };
            for (const [k, v] of Object.entries(req.body)) {
                if (v === undefined) continue;
                push(k, v);
            }
            if (updates.length === 0) {
                return res.status(400).json({ success: false, error: 'No fields to update' });
            }
            values.push(req.params.id, req.userId);
            const r = await query(
                `UPDATE house_contacts SET ${updates.join(', ')}
                 WHERE id = $${values.length - 1} AND user_id = $${values.length}
                 RETURNING *`,
                values,
            );
            if (r.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Contact not found' });
            }
            // Re-fetch with the JOIN to keep the response shape consistent.
            const enriched = await query(
                `SELECT c.*, e.name as equipment_name
                 FROM house_contacts c
                 LEFT JOIN house_equipments e ON c.equipment_id = e.id
                 WHERE c.id = $1 AND c.user_id = $2`,
                [r.rows[0].id, req.userId],
            );
            res.json({ success: true, data: mapContact(enriched.rows[0]) });
        } catch (error) {
            if (error instanceof Error && error.message === 'INVALID_EQUIPMENT') {
                return res.status(400).json({ success: false, error: 'Equipment not found' });
            }
            logger.error('house.update_contact_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

router.delete('/contacts/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            'DELETE FROM house_contacts WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Contact not found' });
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('house.delete_contact_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// Rooms & Items (Phase 4) — "où est X ?"
// ---------------------------------------------------------------------------

const mapRoom = (row: any) => ({
    id: row.id as string,
    name: row.name as string,
    category: row.category as string,
    color: row.color as string,
    notes: row.notes ?? null,
    items_count: row.items_count !== undefined ? Number(row.items_count) : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

const mapItem = (row: any) => ({
    id: row.id as string,
    name: row.name as string,
    category: row.category as string,
    room_id: row.room_id ?? null,
    room_name: row.room_name ?? null,
    room_color: row.room_color ?? null,
    quantity: row.quantity ?? null,
    location_detail: row.location_detail ?? null,
    photo_url: row.photo_url ?? null,
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

const ensureRoomBelongsToUserOrNull = async (
    roomId: string | null | undefined,
    userId: string,
): Promise<void> => {
    if (!roomId) return;
    const r = await query('SELECT id FROM house_rooms WHERE id = $1 AND user_id = $2', [
        roomId,
        userId,
    ]);
    if (r.rows.length === 0) throw new Error('INVALID_ROOM');
};

router.get('/rooms', async (req: AuthRequest, res) => {
    try {
        // LEFT JOIN + count gives the room cards their "X objets" badge in
        // a single round-trip. Cheap because the items table has the
        // room_id index.
        const r = await query(
            `SELECT r.*, COUNT(i.id) AS items_count
             FROM house_rooms r
             LEFT JOIN house_items i ON i.room_id = r.id
             WHERE r.user_id = $1
             GROUP BY r.id
             ORDER BY r.name ASC`,
            [req.userId],
        );
        res.json({ success: true, data: r.rows.map(mapRoom) });
    } catch (error) {
        logger.error('house.list_rooms_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/rooms', validate({ body: roomBodySchema }), async (req: AuthRequest, res) => {
    try {
        const b = req.body;
        const r = await query(
            `INSERT INTO house_rooms (user_id, name, category, color, notes)
             VALUES ($1, $2, $3, COALESCE($4, '#3B82F6'), $5)
             RETURNING *`,
            [req.userId, b.name, b.category, b.color ?? null, b.notes ?? null],
        );
        res.status(201).json({ success: true, data: mapRoom(r.rows[0]) });
    } catch (error) {
        logger.error('house.create_room_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.patch('/rooms/:id', validate({ body: roomPatchSchema }), async (req: AuthRequest, res) => {
    try {
        const updates: string[] = [];
        const values: any[] = [];
        const push = (col: string, val: any) => {
            values.push(val);
            updates.push(`${col} = $${values.length}`);
        };
        for (const [k, v] of Object.entries(req.body)) {
            if (v === undefined) continue;
            push(k, v);
        }
        values.push(req.params.id, req.userId);
        const r = await query(
            `UPDATE house_rooms SET ${updates.join(', ')}
                 WHERE id = $${values.length - 1} AND user_id = $${values.length}
                 RETURNING *`,
            values,
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }
        res.json({ success: true, data: mapRoom(r.rows[0]) });
    } catch (error) {
        logger.error('house.update_room_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.delete('/rooms/:id', async (req: AuthRequest, res) => {
    try {
        // FK ON DELETE SET NULL on items.room_id — items are orphaned, not
        // dropped. The user can re-room them from the "À ranger" filter.
        const r = await query(
            'DELETE FROM house_rooms WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('house.delete_room_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Items
const SELECT_ITEM_FULL = `
    SELECT i.*, r.name AS room_name, r.color AS room_color
    FROM house_items i
    LEFT JOIN house_rooms r ON i.room_id = r.id
`;

router.get('/items', validate({ query: itemListQuerySchema }), async (req: AuthRequest, res) => {
    try {
        const { room_id, category, q, orphan } = req.query as {
            room_id?: string;
            category?: string;
            q?: string;
            orphan?: boolean;
        };
        const params: any[] = [req.userId];
        let sql = `${SELECT_ITEM_FULL} WHERE i.user_id = $1`;
        if (room_id) {
            params.push(room_id);
            sql += ` AND i.room_id = $${params.length}`;
        }
        if (orphan === true) sql += ' AND i.room_id IS NULL';
        if (orphan === false) sql += ' AND i.room_id IS NOT NULL';
        if (category) {
            params.push(category);
            sql += ` AND i.category = $${params.length}`;
        }
        if (q) {
            params.push(`%${q.toLowerCase()}%`);
            // ILIKE on lower(name) — uses the dedicated index for the
            // hot "Où est X ?" path. Also fall-through to notes/location.
            sql += ` AND (lower(i.name) LIKE $${params.length}
                              OR lower(i.location_detail) LIKE $${params.length}
                              OR lower(i.notes) LIKE $${params.length})`;
        }
        sql += ' ORDER BY i.name ASC';
        const r = await query(sql, params);
        res.json({ success: true, data: r.rows.map(mapItem) });
    } catch (error) {
        logger.error('house.list_items_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/items', validate({ body: itemBodySchema }), async (req: AuthRequest, res) => {
    try {
        const b = req.body;
        await ensureRoomBelongsToUserOrNull(b.room_id, req.userId!);
        const insert = await query(
            `INSERT INTO house_items
                (user_id, name, category, room_id, quantity,
                 location_detail, photo_url, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING id`,
            [
                req.userId,
                b.name,
                b.category,
                b.room_id ?? null,
                b.quantity ?? null,
                b.location_detail ?? null,
                b.photo_url ?? null,
                b.notes ?? null,
            ],
        );
        const r = await query(`${SELECT_ITEM_FULL} WHERE i.id = $1 AND i.user_id = $2`, [
            insert.rows[0].id,
            req.userId,
        ]);
        res.status(201).json({ success: true, data: mapItem(r.rows[0]) });
    } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_ROOM') {
            return res.status(400).json({ success: false, error: 'Room not found' });
        }
        logger.error('house.create_item_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.patch('/items/:id', validate({ body: itemPatchSchema }), async (req: AuthRequest, res) => {
    try {
        if (req.body.room_id !== undefined) {
            await ensureRoomBelongsToUserOrNull(req.body.room_id, req.userId!);
        }
        const updates: string[] = [];
        const values: any[] = [];
        const push = (col: string, val: any) => {
            values.push(val);
            updates.push(`${col} = $${values.length}`);
        };
        for (const [k, v] of Object.entries(req.body)) {
            if (v === undefined) continue;
            push(k, v);
        }
        values.push(req.params.id, req.userId);
        const upd = await query(
            `UPDATE house_items SET ${updates.join(', ')}
                 WHERE id = $${values.length - 1} AND user_id = $${values.length}
                 RETURNING id`,
            values,
        );
        if (upd.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Item not found' });
        }
        const r = await query(`${SELECT_ITEM_FULL} WHERE i.id = $1 AND i.user_id = $2`, [
            upd.rows[0].id,
            req.userId,
        ]);
        res.json({ success: true, data: mapItem(r.rows[0]) });
    } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_ROOM') {
            return res.status(400).json({ success: false, error: 'Room not found' });
        }
        logger.error('house.update_item_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.delete('/items/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            'DELETE FROM house_items WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Item not found' });
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('house.delete_item_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/house/items/move
 * Body: { ids: string[], room_id: string | null }
 *
 * Bulk move: efficient when the user grabs 5 items and drops them in the new
 * "Garage" they just created (or in "À ranger" to clear orphan status).
 * Validates room ownership ONCE up-front; all moves succeed or none (single
 * UPDATE with WHERE id = ANY).
 */
router.post(
    '/items/move',
    validate({ body: itemsMoveBodySchema }),
    async (req: AuthRequest, res) => {
        try {
            const { ids, room_id } = req.body as { ids: string[]; room_id: string | null };
            await ensureRoomBelongsToUserOrNull(room_id, req.userId!);
            const r = await query(
                `UPDATE house_items SET room_id = $1
                 WHERE user_id = $2 AND id = ANY($3::uuid[])
                 RETURNING id`,
                [room_id, req.userId, ids],
            );
            res.json({ success: true, data: { moved: r.rowCount ?? 0 } });
        } catch (error) {
            if (error instanceof Error && error.message === 'INVALID_ROOM') {
                return res.status(400).json({ success: false, error: 'Room not found' });
            }
            logger.error('house.move_items_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

// ---------------------------------------------------------------------------
// Projects (Phase 5) — house renovation/work projects with checklist
// ---------------------------------------------------------------------------

const mapProject = (row: any) => ({
    id: row.id as string,
    name: row.name as string,
    category: row.category as string,
    status: row.status as string,
    description: row.description ?? null,
    planned_budget: row.planned_budget !== null ? Number(row.planned_budget) : null,
    started_at: row.started_at ?? null,
    target_end: row.target_end ?? null,
    completed_at: row.completed_at ?? null,
    checklist: (row.checklist as ChecklistItem[] | null) ?? [],
    notes: row.notes ?? null,
    documents_count: row.documents_count !== undefined ? Number(row.documents_count) : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

router.get(
    '/projects',
    validate({ query: projectListQuerySchema }),
    async (req: AuthRequest, res) => {
        try {
            const { status } = req.query as { status?: string };
            const params: any[] = [req.userId];
            // LEFT JOIN with documents count so the project cards can show
            // a "📎 N" badge in one round-trip.
            let sql = `
                SELECT p.*, COUNT(d.id) AS documents_count
                FROM house_projects p
                LEFT JOIN house_documents d ON d.project_id = p.id
                WHERE p.user_id = $1`;
            if (status) {
                params.push(status);
                sql += ` AND p.status = $${params.length}`;
            }
            sql += ' GROUP BY p.id ORDER BY p.created_at DESC';
            const r = await query(sql, params);
            res.json({ success: true, data: r.rows.map(mapProject) });
        } catch (error) {
            logger.error('house.list_projects_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

router.post('/projects', validate({ body: projectBodySchema }), async (req: AuthRequest, res) => {
    try {
        const b = req.body;
        const r = await query(
            `INSERT INTO house_projects
                    (user_id, name, category, status, description, planned_budget,
                     started_at, target_end, completed_at, checklist, notes)
                 VALUES ($1, $2, $3, COALESCE($4, 'Idée'), $5, $6, $7, $8, $9,
                         COALESCE($10::jsonb, '[]'::jsonb), $11)
                 RETURNING *`,
            [
                req.userId,
                b.name,
                b.category,
                b.status ?? null,
                b.description ?? null,
                b.planned_budget ?? null,
                b.started_at ?? null,
                b.target_end ?? null,
                b.completed_at ?? null,
                b.checklist ? JSON.stringify(b.checklist) : null,
                b.notes ?? null,
            ],
        );
        res.status(201).json({ success: true, data: mapProject(r.rows[0]) });
    } catch (error) {
        logger.error('house.create_project_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/projects/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            `SELECT p.*, COUNT(d.id) AS documents_count
             FROM house_projects p
             LEFT JOIN house_documents d ON d.project_id = p.id
             WHERE p.id = $1 AND p.user_id = $2
             GROUP BY p.id`,
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }
        res.json({ success: true, data: mapProject(r.rows[0]) });
    } catch (error) {
        logger.error('house.get_project_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.patch(
    '/projects/:id',
    validate({ body: projectPatchSchema }),
    async (req: AuthRequest, res) => {
        try {
            const updates: string[] = [];
            const values: any[] = [];
            const push = (col: string, val: any) => {
                values.push(val);
                updates.push(`${col} = $${values.length}`);
            };
            for (const [k, v] of Object.entries(req.body)) {
                if (v === undefined) continue;
                if (k === 'checklist') {
                    push('checklist', JSON.stringify(v));
                } else {
                    push(k, v);
                }
            }
            if (updates.length === 0) {
                return res.status(400).json({ success: false, error: 'No fields to update' });
            }
            values.push(req.params.id, req.userId);
            const r = await query(
                `UPDATE house_projects SET ${updates.join(', ')}
                 WHERE id = $${values.length - 1} AND user_id = $${values.length}
                 RETURNING *`,
                values,
            );
            if (r.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Project not found' });
            }
            res.json({ success: true, data: mapProject(r.rows[0]) });
        } catch (error) {
            logger.error('house.update_project_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

router.delete('/projects/:id', async (req: AuthRequest, res) => {
    try {
        const r = await query(
            'DELETE FROM house_projects WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('house.delete_project_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * PATCH /api/house/projects/:id/checklist
 * Body: { op: 'add'|'toggle'|'rename'|'remove'|'reorder', ... }
 *
 * Atomic single-item edit applied inside a transaction with a row lock so
 * two tabs editing the checklist concurrently don't blow each other's
 * changes away. The whole checklist (after the op) is returned so the UI
 * can reconcile in one shot.
 */
router.patch(
    '/projects/:id/checklist',
    validate({ body: checklistOpSchema }),
    async (req: AuthRequest, res) => {
        const client = await getClient();
        try {
            await client.query('BEGIN');
            const before = await client.query(
                'SELECT checklist FROM house_projects WHERE id = $1 AND user_id = $2 FOR UPDATE',
                [req.params.id, req.userId],
            );
            if (before.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Project not found' });
            }
            const current = (before.rows[0].checklist as ChecklistItem[] | null) ?? [];
            const op = req.body as ChecklistOp;

            let next: ChecklistItem[];
            switch (op.op) {
                case 'add':
                    if (current.length >= 30) {
                        await client.query('ROLLBACK');
                        return res.status(400).json({
                            success: false,
                            error: 'Checklist max size is 30 items',
                        });
                    }
                    next = [...current, { id: randomUUID(), label: op.label, done: false }];
                    break;
                case 'toggle':
                    next = current.map((i) => (i.id === op.id ? { ...i, done: !i.done } : i));
                    break;
                case 'rename':
                    next = current.map((i) => (i.id === op.id ? { ...i, label: op.label } : i));
                    break;
                case 'remove':
                    next = current.filter((i) => i.id !== op.id);
                    break;
                case 'reorder': {
                    // Apply the order from `op.ids`, append any items the
                    // client didn't include (defensive — shouldn't happen
                    // but easier than rejecting partial input).
                    const byId = new Map(current.map((i) => [i.id, i] as const));
                    const reordered: ChecklistItem[] = [];
                    for (const id of op.ids) {
                        const item = byId.get(id);
                        if (item) {
                            reordered.push(item);
                            byId.delete(id);
                        }
                    }
                    for (const remaining of byId.values()) reordered.push(remaining);
                    next = reordered;
                    break;
                }
            }

            const updated = await client.query(
                `UPDATE house_projects SET checklist = $1::jsonb
                 WHERE id = $2 AND user_id = $3
                 RETURNING checklist`,
                [JSON.stringify(next), req.params.id, req.userId],
            );
            await client.query('COMMIT');
            res.json({
                success: true,
                data: { checklist: updated.rows[0].checklist as ChecklistItem[] },
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            logger.error('house.checklist_op_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        } finally {
            client.release();
        }
    },
);

// ---------------------------------------------------------------------------
// Dashboard aggregator (used by HouseAlertsCard)
// ---------------------------------------------------------------------------

router.get('/dashboard', async (req: AuthRequest, res) => {
    try {
        const upcoming = await query(
            `SELECT m.*, e.name as equipment_name, e.category as equipment_category
             FROM house_maintenance m
             JOIN house_equipments e ON m.equipment_id = e.id
             WHERE m.user_id = $1
               AND m.planned_date IS NOT NULL
               AND m.planned_date >= CURRENT_DATE
               AND m.planned_date <= CURRENT_DATE + INTERVAL '30 days'
             ORDER BY m.planned_date ASC
             LIMIT 5`,
            [req.userId],
        );
        const warranties = await query(
            `SELECT id, name, category, warranty_until
             FROM house_equipments
             WHERE user_id = $1
               AND warranty_until IS NOT NULL
               AND warranty_until >= CURRENT_DATE
               AND warranty_until <= CURRENT_DATE + INTERVAL '60 days'
             ORDER BY warranty_until ASC
             LIMIT 5`,
            [req.userId],
        );
        // Active contracts due in the next 7 days (or already overdue) +
        // monthly-equivalent total across all active contracts. Useful as
        // a single number on the home page: "Tu paies ~ 720€/mois en
        // abonnements et factures récurrentes".
        const upcomingContracts = await query(
            `SELECT * FROM house_contracts
             WHERE user_id = $1
               AND is_active = true
               AND next_due_date <= CURRENT_DATE + INTERVAL '7 days'
             ORDER BY next_due_date ASC
             LIMIT 5`,
            [req.userId],
        );
        const allActiveContracts = await query(
            `SELECT amount, frequency FROM house_contracts
             WHERE user_id = $1 AND is_active = true`,
            [req.userId],
        );
        let monthlyEstimated = 0;
        for (const row of allActiveContracts.rows) {
            const months = FREQUENCY_MONTHS[row.frequency as string];
            if (months && months > 0) monthlyEstimated += Number(row.amount) / months;
        }

        const counts = await query(
            `SELECT
                (SELECT COUNT(*) FROM house_equipments WHERE user_id = $1) AS equipments,
                (SELECT COUNT(*) FROM house_maintenance WHERE user_id = $1
                    AND planned_date IS NOT NULL
                    AND planned_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days')
                  AS upcoming_30d,
                (SELECT COUNT(*) FROM house_equipments WHERE user_id = $1
                    AND warranty_until IS NOT NULL
                    AND warranty_until BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days')
                  AS warranties_60d,
                (SELECT COUNT(*) FROM house_contracts WHERE user_id = $1 AND is_active = true)
                  AS active_contracts,
                (SELECT COUNT(*) FROM house_contracts WHERE user_id = $1 AND is_active = true
                    AND next_due_date <= CURRENT_DATE + INTERVAL '7 days')
                  AS contracts_due_7d`,
            [req.userId],
        );
        res.json({
            success: true,
            data: {
                upcoming_maintenance: upcoming.rows.map(mapMaintenance),
                expiring_warranties: warranties.rows.map((r: any) => ({
                    id: r.id as string,
                    name: r.name as string,
                    category: r.category as string,
                    warranty_until: r.warranty_until,
                })),
                upcoming_contracts: upcomingContracts.rows.map(mapContract),
                monthly_estimated_total: Math.round(monthlyEstimated * 100) / 100,
                counts: {
                    equipments: Number(counts.rows[0].equipments),
                    upcoming_30d: Number(counts.rows[0].upcoming_30d),
                    warranties_60d: Number(counts.rows[0].warranties_60d),
                    active_contracts: Number(counts.rows[0].active_contracts),
                    contracts_due_7d: Number(counts.rows[0].contracts_due_7d),
                },
            },
        });
    } catch (error) {
        logger.error('house.dashboard_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
