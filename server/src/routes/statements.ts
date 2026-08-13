import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import { getClient, query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
    statementBulkPatchSchema,
    statementConfirmSchema,
    statementDeleteQuerySchema,
    statementIdParamsSchema,
    statementListQuerySchema,
    statementTransactionParamsSchema,
    statementTransactionPatchSchema,
} from '../schemas/statements';
import {
    extractStatementSummary,
    extractStatementTransactions,
    type SourcedStatementTransaction,
} from '../ai/AIService';
import { AiError } from '../ai/errors';
import {
    chunkStatementText,
    extractPdfText,
    PdfExtractionError,
    type PdfTextResult,
} from '../lib/pdfText';
import logger from '../lib/logger';

// =============================================================================
// /api/statements — monthly bank & credit-card statement import
//
// The flow, and why it has four steps rather than one:
//
//   1. POST /import          upload a PDF → parse → AI extraction → staged
//   2. GET  /:id             the user reviews what the model proposed
//   3. PATCH /:id/tx/:txId   the user corrects categories, ignores transfers
//   4. POST /:id/confirm     staged rows become budget_entries
//
// Step 4 is the only writer to budget_entries. Nothing an AI produced ever
// lands in the user's real budget without a human pressing confirm — the same
// contract the receipt scanner already honours, and the reason the extraction
// is allowed to be imperfect.
//
// Once confirmed, the existing budget dashboard, /api/budget/statistics and
// /api/ai/budget/analyze-month all light up with no further work: the imported
// rows are ordinary budget_entries, distinguishable only by source='statement'.
// =============================================================================

const router = Router();
router.use(authMiddleware);

// A text-layer statement PDF is tens of kilobytes. 15 MB is roomy enough for
// an issuer that embeds a full-page logo, and small enough that the parse
// stays inside a request timeout.
const PDF_MAX_BYTES = 15 * 1024 * 1024;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: PDF_MAX_BYTES, files: 1 },
});

/**
 * Multer wrapper that turns upload failures into the same JSON envelope every
 * other route uses, instead of letting them bubble up as an HTML error page.
 * Mirrors `singleImageUpload` in routes/ai.ts.
 */
const singlePdfUpload = (): import('express').RequestHandler => (req, res, next) => {
    upload.single('file')(req, res, (err: unknown) => {
        if (!err) return next();
        if ((err as { code?: string })?.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                success: false,
                error: {
                    code: 'FILE_TOO_LARGE',
                    message: `Relevé trop volumineux (max ${PDF_MAX_BYTES / (1024 * 1024)} Mo).`,
                },
            });
        }
        logger.warn('statements.upload_multer_error', {
            error: err instanceof Error ? err.message : String(err),
        });
        return res.status(400).json({ success: false, error: 'Upload error' });
    });
};

// Fallback categories offered to the model when the household has no history
// yet. Mirrors RECEIPT_DEFAULT_CATEGORIES in routes/ai.ts plus the ones a card
// statement produces that a grocery receipt never does.
const STATEMENT_DEFAULT_CATEGORIES = [
    'Alimentation',
    'Santé',
    'Enfants',
    'Maison',
    'Loisirs',
    'Transport',
    'Abonnement',
    'Paiement carte',
    'Autre',
];

// Lines that are transfers rather than household spending: paying the card
// itself, moving money between own accounts, a merchant refund. Importing
// these as income would inflate the household's revenue by the exact amount it
// already counted as expenses, so they default to 'ignored' — visible in the
// review table, one click away from being restored.
const TRANSFER_PATTERNS =
    /\b(paiement\s+(caisse|carte|recu|re[çc]u)|virement|transfert|remboursement|credit\s+remises|cr[ée]dit\s+remises|payment\s+received|autopay|pre[- ]?authorized\s+payment)\b/i;

const toNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
};

/**
 * Shape of a statement row once the NUMERIC columns are turned into numbers.
 *
 * The explicit interface exists because object spread over a
 * `Record<string, unknown>` drops the index signature in TypeScript, which
 * would leave every pass-through column (id, status, due_date…) untyped at the
 * call sites that read them.
 */
interface StatementDto {
    id: string;
    status: string;
    currency: string;
    issuer: string | null;
    account_label: string | null;
    card_last4: string | null;
    statement_date: string | null;
    period_start: string | null;
    period_end: string | null;
    due_date: string | null;
    warnings: string[];
    previous_balance: number | null;
    new_balance: number | null;
    total_purchases: number | null;
    total_payments: number | null;
    total_cash_advances: number | null;
    total_fees: number | null;
    minimum_due: number | null;
    credit_limit: number | null;
    available_credit: number | null;
    interest_rate_purchases: number | null;
    rewards_earned: number | null;
    reconciliation_delta: number | null;
    page_count: number | null;
    transaction_count: number | null;
    pending_count: number | null;
    imported_count: number | null;
    ignored_count: number | null;
    duplicate_count: number | null;
    [key: string]: unknown;
}

const mapStatement = (row: Record<string, unknown>): StatementDto =>
    ({
        ...row,
        previous_balance: toNumber(row.previous_balance),
        new_balance: toNumber(row.new_balance),
        total_purchases: toNumber(row.total_purchases),
        total_payments: toNumber(row.total_payments),
        total_cash_advances: toNumber(row.total_cash_advances),
        total_fees: toNumber(row.total_fees),
        minimum_due: toNumber(row.minimum_due),
        credit_limit: toNumber(row.credit_limit),
        available_credit: toNumber(row.available_credit),
        interest_rate_purchases: toNumber(row.interest_rate_purchases),
        rewards_earned: toNumber(row.rewards_earned),
        reconciliation_delta: toNumber(row.reconciliation_delta),
        page_count: toNumber(row.page_count),
        transaction_count: toNumber(row.transaction_count),
        pending_count: toNumber(row.pending_count),
        imported_count: toNumber(row.imported_count),
        ignored_count: toNumber(row.ignored_count),
        duplicate_count: toNumber(row.duplicate_count),
    }) as StatementDto;

const mapTransaction = (row: Record<string, unknown>) => ({
    ...row,
    amount: toNumber(row.amount) ?? 0,
    is_expense: Boolean(row.is_expense),
    line_no: toNumber(row.line_no) ?? 0,
});

/**
 * Stable identity of a transaction across statements.
 *
 * Normalizing the description matters: the same purchase can come back as
 * "MAXI ST-LAMBERT #5404" on one statement and "MAXI ST-LAMBERT  #5404" on a
 * corrected reissue. Case, punctuation and spacing are noise; the date, the
 * amount and the direction are not.
 */
const dedupHash = (
    userId: string,
    date: string,
    description: string,
    amount: number,
    isExpense: boolean,
): string => {
    const normalized = description
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    return createHash('sha256')
        .update(`${userId}|${date}|${normalized}|${amount.toFixed(2)}|${isExpense ? 'd' : 'c'}`)
        .digest('hex');
};

/**
 * Drop the repeats produced by overlapping chunks, keep the repeats the
 * household actually made.
 *
 * Two rows with the same key are the same line if and only if they came from
 * different chunks — that is the seam. Two identical rows inside one chunk are
 * two real transactions (the coffee bought twice), and removing them would
 * quietly understate the month.
 */
const dedupeChunkOverlap = (rows: SourcedStatementTransaction[]): SourcedStatementTransaction[] => {
    const seen = new Map<string, Set<number>>();
    const out: SourcedStatementTransaction[] = [];

    for (const row of rows) {
        const key = `${row.date}|${row.description.toLowerCase()}|${row.amount}|${row.isExpense}`;
        const chunks = seen.get(key);
        if (!chunks) {
            seen.set(key, new Set([row.chunkIndex]));
            out.push(row);
            continue;
        }
        if (chunks.has(row.chunkIndex)) {
            // Same chunk saw it again → a genuine repeat purchase.
            out.push(row);
            continue;
        }
        // A different chunk produced the same line → seam artefact, drop it.
        chunks.add(row.chunkIndex);
    }

    return out;
};

const sendImportError = (res: import('express').Response, error: unknown): void => {
    if (error instanceof PdfExtractionError) {
        logger.warn('statements.pdf_extraction_failed', { code: error.code });
        res.status(422).json({
            success: false,
            error: { code: error.code, message: error.message },
        });
        return;
    }
    if (error instanceof AiError) {
        logger.warn('statements.ai_failed', { code: error.code, message: error.message });
        res.status(error.status).json({ success: false, error: error.toJSON() });
        return;
    }
    logger.error('statements.import_unexpected', {
        error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ success: false, error: 'Internal server error' });
};

/** Categories the household already uses — better hints than a static list. */
const loadSuggestedCategories = async (userId: string): Promise<string[]> => {
    const result = await query(
        `SELECT category, COUNT(*)::int AS n
           FROM budget_entries
          WHERE user_id = $1
          GROUP BY category
          ORDER BY n DESC
          LIMIT 25`,
        [userId],
    );
    const used = result.rows.map((r) => String(r.category)).filter(Boolean);
    // Union, preserving the household's own order first.
    return [...new Set([...used, ...STATEMENT_DEFAULT_CATEGORIES])].slice(0, 30);
};

// ---------------------------------------------------------------------------
// POST /api/statements/import
// ---------------------------------------------------------------------------
router.post('/import', singlePdfUpload(), async (req: AuthRequest, res) => {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file) {
        return res.status(400).json({
            success: false,
            error: { code: 'NO_FILE', message: 'Aucun fichier reçu (champ attendu : "file").' },
        });
    }
    if (file.mimetype !== 'application/pdf') {
        return res.status(415).json({
            success: false,
            error: {
                code: 'UNSUPPORTED_TYPE',
                message: `Type non supporté : ${file.mimetype}. Envoie le relevé au format PDF.`,
            },
        });
    }

    let pdf: PdfTextResult;
    try {
        pdf = await extractPdfText(file.buffer);
    } catch (error) {
        return sendImportError(res, error);
    }

    try {
        // Re-uploading the same document is a mistake, not an intent. Return
        // the existing statement so the client can navigate to it instead of
        // creating a second copy of every line.
        const existing = await query(
            'SELECT id, status, statement_date FROM bank_statements WHERE user_id = $1 AND content_hash = $2',
            [req.userId, pdf.contentHash],
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'ALREADY_IMPORTED',
                    message: 'Ce relevé a déjà été importé.',
                },
                data: { statement: existing.rows[0] },
            });
        }

        const userRow = await query('SELECT currency FROM users WHERE id = $1', [req.userId]);
        const userCurrency =
            typeof userRow.rows[0]?.currency === 'string'
                ? (userRow.rows[0].currency as string)
                : undefined;

        const suggestedCategories = await loadSuggestedCategories(req.userId!);

        // --- Stage 1: the summary block -------------------------------------
        const { summary, model: summaryModel } = await extractStatementSummary(
            { text: pdf.text, filename: file.originalname, userCurrency },
            { userId: req.userId! },
        );

        // --- Stage 2: the transaction lines ---------------------------------
        const chunks = chunkStatementText(pdf.text);
        const extraction = await extractStatementTransactions(
            {
                chunks,
                periodStart: summary.periodStart,
                periodEnd: summary.periodEnd ?? summary.statementDate,
                suggestedCategories,
            },
            { userId: req.userId! },
        );

        const rows = dedupeChunkOverlap(extraction.transactions).sort((a, b) =>
            a.date === b.date
                ? a.description.localeCompare(b.description)
                : a.date.localeCompare(b.date),
        );

        // --- Cross-statement duplicates -------------------------------------
        const hashes = rows.map((r) =>
            dedupHash(req.userId!, r.date, r.description, r.amount, r.isExpense),
        );
        const known = new Set<string>();
        if (hashes.length > 0) {
            const seen = await query(
                `SELECT DISTINCT dedup_hash
                   FROM bank_statement_transactions
                  WHERE user_id = $1
                    AND status IN ('pending', 'imported')
                    AND dedup_hash = ANY($2::varchar[])`,
                [req.userId, hashes],
            );
            seen.rows.forEach((r) => known.add(String(r.dedup_hash)));
        }

        // --- Reconciliation against the bank's own total --------------------
        const expenseSum = rows.filter((r) => r.isExpense).reduce((acc, r) => acc + r.amount, 0);
        const reconciliationDelta =
            summary.totalPurchases !== null
                ? Math.round((expenseSum - summary.totalPurchases) * 100) / 100
                : null;

        const warnings = [...summary.warnings];
        if (extraction.failedChunks.length > 0) {
            warnings.push(
                `${extraction.failedChunks.length} section(s) du relevé n'ont pas pu être lues — vérifie que rien ne manque.`,
            );
        }
        if (reconciliationDelta !== null && Math.abs(reconciliationDelta) >= 0.01) {
            warnings.push(
                `Écart de ${reconciliationDelta.toFixed(2)} entre les lignes extraites et le total d'achats annoncé par la banque.`,
            );
        }
        if (rows.length === 0) {
            warnings.push('Aucune transaction détectée dans ce relevé.');
        }

        // --- Persist ---------------------------------------------------------
        const client = await getClient();
        try {
            await client.query('BEGIN');

            const inserted = await client.query(
                `INSERT INTO bank_statements (
                    user_id, status, issuer, account_label, card_last4, currency,
                    statement_date, period_start, period_end,
                    previous_balance, new_balance, total_purchases, total_payments,
                    total_cash_advances, total_fees, minimum_due, due_date,
                    credit_limit, available_credit, interest_rate_purchases, rewards_earned,
                    source_filename, content_hash, page_count, ai_model,
                    reconciliation_delta, warnings
                 ) VALUES (
                    $1, 'pending_review', $2, $3, $4, $5,
                    $6, $7, $8,
                    $9, $10, $11, $12,
                    $13, $14, $15, $16,
                    $17, $18, $19, $20,
                    $21, $22, $23, $24,
                    $25, $26::jsonb
                 ) RETURNING *`,
                [
                    req.userId,
                    summary.issuer,
                    summary.accountLabel,
                    summary.cardLast4,
                    summary.currency ?? userCurrency ?? 'CAD',
                    summary.statementDate,
                    summary.periodStart,
                    summary.periodEnd,
                    summary.previousBalance,
                    summary.newBalance,
                    summary.totalPurchases,
                    summary.totalPayments,
                    summary.totalCashAdvances,
                    summary.totalFees,
                    summary.minimumDue,
                    summary.dueDate,
                    summary.creditLimit,
                    summary.availableCredit,
                    summary.interestRatePurchases,
                    summary.rewardsEarned,
                    file.originalname?.slice(0, 255) ?? null,
                    pdf.contentHash,
                    pdf.pageCount,
                    extraction.model || summaryModel,
                    reconciliationDelta,
                    JSON.stringify(warnings.slice(0, 8)),
                ],
            );
            const statement = inserted.rows[0];

            for (let i = 0; i < rows.length; i += 1) {
                const row = rows[i];
                const hash = hashes[i];
                const isTransfer =
                    !row.isExpense &&
                    (TRANSFER_PATTERNS.test(row.description) ||
                        row.category.toLowerCase().includes('paiement'));
                const status = known.has(hash) ? 'duplicate' : isTransfer ? 'ignored' : 'pending';

                await client.query(
                    `INSERT INTO bank_statement_transactions (
                        statement_id, user_id, line_no, transaction_date, posted_date,
                        description, merchant, amount, is_expense, category,
                        confidence, status, dedup_hash
                     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                    [
                        statement.id,
                        req.userId,
                        i + 1,
                        row.date,
                        row.postedDate,
                        row.description.slice(0, 255),
                        row.merchant,
                        row.amount,
                        row.isExpense,
                        row.category.slice(0, 50),
                        row.confidence,
                        status,
                        hash,
                    ],
                );
            }

            await client.query('COMMIT');

            logger.info('statements.imported', {
                statementId: statement.id,
                transactions: rows.length,
                duplicates: hashes.filter((h) => known.has(h)).length,
                failedChunks: extraction.failedChunks.length,
                reconciliationDelta,
            });

            const detail = await loadStatementDetail(req.userId!, statement.id);
            return res.status(201).json({ success: true, data: detail });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        return sendImportError(res, error);
    }
});

// ---------------------------------------------------------------------------
// Shared loader
// ---------------------------------------------------------------------------
const loadStatementDetail = async (userId: string, statementId: string) => {
    const statement = await query(
        `SELECT s.*,
                COUNT(t.id)::int AS transaction_count,
                COUNT(t.id) FILTER (WHERE t.status = 'pending')::int   AS pending_count,
                COUNT(t.id) FILTER (WHERE t.status = 'imported')::int  AS imported_count,
                COUNT(t.id) FILTER (WHERE t.status = 'ignored')::int   AS ignored_count,
                COUNT(t.id) FILTER (WHERE t.status = 'duplicate')::int AS duplicate_count
           FROM bank_statements s
           LEFT JOIN bank_statement_transactions t ON t.statement_id = s.id
          WHERE s.id = $1 AND s.user_id = $2
          GROUP BY s.id`,
        [statementId, userId],
    );
    if (statement.rows.length === 0) return null;

    const transactions = await query(
        `SELECT t.*, fm.name AS assigned_to_name, fm.color AS assigned_to_color
           FROM bank_statement_transactions t
           LEFT JOIN family_members fm ON t.assigned_to = fm.id
          WHERE t.statement_id = $1 AND t.user_id = $2
          ORDER BY t.transaction_date ASC, t.line_no ASC`,
        [statementId, userId],
    );

    return {
        statement: mapStatement(statement.rows[0] as Record<string, unknown>),
        transactions: transactions.rows.map((r) => mapTransaction(r as Record<string, unknown>)),
    };
};

// ---------------------------------------------------------------------------
// GET /api/statements
// ---------------------------------------------------------------------------
router.get('/', validate({ query: statementListQuerySchema }), async (req: AuthRequest, res) => {
    try {
        const { status, limit } = req.query as { status?: string; limit?: number };
        const params: unknown[] = [req.userId];
        let where = 's.user_id = $1';
        if (status) {
            params.push(status);
            where += ` AND s.status = $${params.length}`;
        }
        params.push(limit ?? 36);

        const result = await query(
            `SELECT s.*,
                        COUNT(t.id)::int AS transaction_count,
                        COUNT(t.id) FILTER (WHERE t.status = 'pending')::int   AS pending_count,
                        COUNT(t.id) FILTER (WHERE t.status = 'imported')::int  AS imported_count,
                        COUNT(t.id) FILTER (WHERE t.status = 'ignored')::int   AS ignored_count,
                        COUNT(t.id) FILTER (WHERE t.status = 'duplicate')::int AS duplicate_count
                   FROM bank_statements s
                   LEFT JOIN bank_statement_transactions t ON t.statement_id = s.id
                  WHERE ${where}
                  GROUP BY s.id
                  ORDER BY COALESCE(s.statement_date, s.created_at::date) DESC
                  LIMIT $${params.length}`,
            params,
        );

        res.json({
            success: true,
            data: result.rows.map((r) => mapStatement(r as Record<string, unknown>)),
        });
    } catch (error) {
        logger.error('statements.list_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/statements/overview
//
// Everything the Budget dashboard needs to render the statement header in one
// round-trip: the latest statement, the balance trend, and whether a payment
// is due soon. Declared BEFORE /:id so 'overview' is not read as a UUID.
// ---------------------------------------------------------------------------
router.get('/overview', async (req: AuthRequest, res) => {
    try {
        const statements = await query(
            `SELECT id, statement_date, period_start, period_end, currency,
                    new_balance, previous_balance, total_purchases, total_payments,
                    minimum_due, due_date, credit_limit, available_credit,
                    interest_rate_purchases, rewards_earned, status
               FROM bank_statements
              WHERE user_id = $1
              ORDER BY COALESCE(statement_date, created_at::date) DESC
              LIMIT 13`,
            [req.userId],
        );

        const rows = statements.rows.map((r) => mapStatement(r as Record<string, unknown>));
        const latest = rows[0] ?? null;

        // Days until the payment is due. Negative means the due date is past —
        // the UI escalates that from a reminder to an alert.
        let daysUntilDue: number | null = null;
        if (latest?.due_date) {
            const due = new Date(`${String(latest.due_date).slice(0, 10)}T00:00:00Z`);
            const today = new Date();
            const todayUtc = Date.UTC(
                today.getUTCFullYear(),
                today.getUTCMonth(),
                today.getUTCDate(),
            );
            daysUntilDue = Math.round((due.getTime() - todayUtc) / 86_400_000);
        }

        const utilization =
            latest && latest.credit_limit && latest.new_balance !== null
                ? Math.round((latest.new_balance / latest.credit_limit) * 1000) / 10
                : null;

        res.json({
            success: true,
            data: {
                latest,
                // Oldest → newest, ready to feed a chart without reversing.
                history: [...rows].reverse(),
                daysUntilDue,
                utilizationPercent: utilization,
                pendingReviewCount: rows.filter((r) => r.status === 'pending_review').length,
            },
        });
    } catch (error) {
        logger.error('statements.overview_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/statements/:id
// ---------------------------------------------------------------------------
router.get('/:id', validate({ params: statementIdParamsSchema }), async (req: AuthRequest, res) => {
    try {
        const detail = await loadStatementDetail(req.userId!, req.params.id);
        if (!detail) {
            return res.status(404).json({ success: false, error: 'Statement not found' });
        }
        res.json({ success: true, data: detail });
    } catch (error) {
        logger.error('statements.get_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// PATCH /api/statements/:id/transactions/:txId
// ---------------------------------------------------------------------------
router.patch(
    '/:id/transactions/:txId',
    validate({
        params: statementTransactionParamsSchema,
        body: statementTransactionPatchSchema,
    }),
    async (req: AuthRequest, res) => {
        try {
            const { id, txId } = req.params as { id: string; txId: string };
            const patch = req.body as Record<string, unknown>;

            // An already-imported row is frozen: editing it here would silently
            // diverge from the budget_entries row it created. The user edits
            // the budget entry directly instead.
            const current = await query(
                `SELECT status FROM bank_statement_transactions
                  WHERE id = $1 AND statement_id = $2 AND user_id = $3`,
                [txId, id, req.userId],
            );
            if (current.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Transaction not found' });
            }
            if (current.rows[0].status === 'imported') {
                return res.status(409).json({
                    success: false,
                    error: {
                        code: 'ALREADY_IMPORTED',
                        message:
                            'Cette ligne est déjà dans le budget. Modifie-la depuis la liste des entrées.',
                    },
                });
            }

            const sets: string[] = [];
            const params: unknown[] = [];
            const push = (column: string, value: unknown) => {
                params.push(value);
                sets.push(`${column} = $${params.length}`);
            };

            if (patch.category !== undefined) push('category', patch.category);
            if (patch.description !== undefined) push('description', patch.description);
            if (patch.merchant !== undefined) push('merchant', patch.merchant);
            if (patch.amount !== undefined) push('amount', patch.amount);
            if (patch.is_expense !== undefined) push('is_expense', patch.is_expense);
            if (patch.assigned_to !== undefined) push('assigned_to', patch.assigned_to);
            if (patch.transaction_date !== undefined)
                push('transaction_date', patch.transaction_date);
            if (patch.status !== undefined) push('status', patch.status);

            // Editing the amount, date or description changes the row's
            // identity, so its dedup hash has to follow — otherwise a corrected
            // line would keep matching (or stop matching) the wrong statement.
            if (
                patch.amount !== undefined ||
                patch.transaction_date !== undefined ||
                patch.description !== undefined ||
                patch.is_expense !== undefined
            ) {
                const fresh = await query(
                    `SELECT transaction_date, description, amount, is_expense
                       FROM bank_statement_transactions WHERE id = $1`,
                    [txId],
                );
                const r = fresh.rows[0];
                const date =
                    (patch.transaction_date as string) ?? String(r.transaction_date).slice(0, 10);
                const description = (patch.description as string) ?? String(r.description);
                const amount = (patch.amount as number) ?? Number(r.amount);
                const isExpense =
                    patch.is_expense !== undefined
                        ? Boolean(patch.is_expense)
                        : Boolean(r.is_expense);
                push('dedup_hash', dedupHash(req.userId!, date, description, amount, isExpense));
            }

            params.push(txId, id, req.userId);
            const result = await query(
                `UPDATE bank_statement_transactions
                    SET ${sets.join(', ')}
                  WHERE id = $${params.length - 2}
                    AND statement_id = $${params.length - 1}
                    AND user_id = $${params.length}
                RETURNING *`,
                params,
            );

            res.json({
                success: true,
                data: mapTransaction(result.rows[0] as Record<string, unknown>),
            });
        } catch (error) {
            logger.error('statements.patch_transaction_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

// ---------------------------------------------------------------------------
// PATCH /api/statements/:id/transactions — bulk
// ---------------------------------------------------------------------------
router.patch(
    '/:id/transactions',
    validate({ params: statementIdParamsSchema, body: statementBulkPatchSchema }),
    async (req: AuthRequest, res) => {
        try {
            const { id } = req.params as { id: string };
            const body = req.body as {
                transaction_ids: string[];
                status?: string;
                category?: string;
                assigned_to?: string | null;
            };

            const sets: string[] = [];
            const params: unknown[] = [];
            const push = (column: string, value: unknown) => {
                params.push(value);
                sets.push(`${column} = $${params.length}`);
            };
            if (body.status !== undefined) push('status', body.status);
            if (body.category !== undefined) push('category', body.category);
            if ('assigned_to' in body) push('assigned_to', body.assigned_to ?? null);

            params.push(body.transaction_ids, id, req.userId);
            const result = await query(
                `UPDATE bank_statement_transactions
                    SET ${sets.join(', ')}
                  WHERE id = ANY($${params.length - 2}::uuid[])
                    AND statement_id = $${params.length - 1}
                    AND user_id = $${params.length}
                    AND status <> 'imported'
                RETURNING id`,
                params,
            );

            res.json({ success: true, data: { updated: result.rows.length } });
        } catch (error) {
            logger.error('statements.bulk_patch_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

// ---------------------------------------------------------------------------
// POST /api/statements/:id/confirm
//
// The single writer to budget_entries. Idempotent by construction: it only
// picks up rows still in 'pending', so pressing confirm twice imports nothing
// the second time, and a statement whose review was interrupted can be
// finished later without duplicating what already went through.
// ---------------------------------------------------------------------------
router.post(
    '/:id/confirm',
    validate({ params: statementIdParamsSchema, body: statementConfirmSchema }),
    async (req: AuthRequest, res) => {
        const { id } = req.params as { id: string };
        const { include_duplicates: includeDuplicates, assigned_to: assignedTo } = req.body as {
            include_duplicates: boolean;
            assigned_to?: string | null;
        };

        const client = await getClient();
        try {
            await client.query('BEGIN');

            const owned = await client.query(
                'SELECT id, currency FROM bank_statements WHERE id = $1 AND user_id = $2 FOR UPDATE',
                [id, req.userId],
            );
            if (owned.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Statement not found' });
            }

            const statuses = includeDuplicates ? ['pending', 'duplicate'] : ['pending'];
            const pending = await client.query(
                `SELECT * FROM bank_statement_transactions
                  WHERE statement_id = $1 AND user_id = $2 AND status = ANY($3::varchar[])
                  ORDER BY transaction_date ASC, line_no ASC`,
                [id, req.userId, statuses],
            );

            let imported = 0;
            for (const tx of pending.rows) {
                const description = [tx.merchant, tx.description]
                    .filter((v, i, arr) => v && arr.indexOf(v) === i)
                    .join(' — ')
                    .slice(0, 500);

                const entry = await client.query(
                    `INSERT INTO budget_entries
                        (user_id, category, amount, description, date, is_expense, assigned_to, source)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 'statement')
                     RETURNING id`,
                    [
                        req.userId,
                        tx.category,
                        tx.amount,
                        description || tx.description,
                        tx.transaction_date,
                        tx.is_expense,
                        assignedTo ?? tx.assigned_to ?? null,
                    ],
                );

                await client.query(
                    `UPDATE bank_statement_transactions
                        SET status = 'imported', budget_entry_id = $1
                      WHERE id = $2`,
                    [entry.rows[0].id, tx.id],
                );
                imported += 1;
            }

            // The statement is done once nothing is left waiting on a decision.
            await client.query(
                `UPDATE bank_statements
                    SET status = CASE
                            WHEN NOT EXISTS (
                                SELECT 1 FROM bank_statement_transactions
                                 WHERE statement_id = $1 AND status = 'pending'
                            ) THEN 'imported'
                            ELSE status
                        END,
                        imported_at = COALESCE(imported_at, CURRENT_TIMESTAMP)
                  WHERE id = $1`,
                [id],
            );

            await client.query('COMMIT');

            logger.info('statements.confirmed', { statementId: id, imported });

            const detail = await loadStatementDetail(req.userId!, id);
            res.json({ success: true, data: { ...detail, imported } });
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('statements.confirm_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        } finally {
            client.release();
        }
    },
);

// ---------------------------------------------------------------------------
// DELETE /api/statements/:id
// ---------------------------------------------------------------------------
router.delete(
    '/:id',
    validate({ params: statementIdParamsSchema, query: statementDeleteQuerySchema }),
    async (req: AuthRequest, res) => {
        const { id } = req.params as { id: string };
        const withEntries = (req.query as { with_entries?: boolean }).with_entries === true;

        const client = await getClient();
        try {
            await client.query('BEGIN');

            const owned = await client.query(
                'SELECT id FROM bank_statements WHERE id = $1 AND user_id = $2 FOR UPDATE',
                [id, req.userId],
            );
            if (owned.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Statement not found' });
            }

            let removedEntries = 0;
            if (withEntries) {
                const deleted = await client.query(
                    `DELETE FROM budget_entries
                      WHERE user_id = $1
                        AND id IN (
                            SELECT budget_entry_id FROM bank_statement_transactions
                             WHERE statement_id = $2 AND budget_entry_id IS NOT NULL
                        )
                    RETURNING id`,
                    [req.userId, id],
                );
                removedEntries = deleted.rows.length;
            }

            // Statement rows cascade to their transactions.
            await client.query('DELETE FROM bank_statements WHERE id = $1 AND user_id = $2', [
                id,
                req.userId,
            ]);

            await client.query('COMMIT');
            logger.info('statements.deleted', { statementId: id, removedEntries, withEntries });
            res.json({ success: true, data: { removedEntries } });
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('statements.delete_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        } finally {
            client.release();
        }
    },
);

export default router;
