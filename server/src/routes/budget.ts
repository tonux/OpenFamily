import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
    budgetMonthlyStatisticsQuerySchema,
    budgetStatisticsQuerySchema,
    type BudgetSource,
} from '../schemas/budget';
import { toNullIfEmpty, toOptionalNumber } from '../lib/normalize';
import logger from '../lib/logger';

const router = Router();
router.use(authMiddleware);

const toNumber = (value: unknown): number => {
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
};

const mapBudgetEntry = (row: any) => ({
    ...row,
    amount: toNumber(row.amount),
    is_expense: Boolean(row.is_expense),
});

const mapBudgetLimit = (row: any) => ({
    ...row,
    monthly_limit: toNumber(row.monthly_limit),
    month: toNumber(row.month),
    year: toNumber(row.year),
});

/**
 * SQL fragment restricting a statistics query to one provenance.
 *
 * Appends its parameter to `params` so callers keep control of the numbering.
 * Returns an empty string for 'all', which is the common case and must not
 * cost a placeholder.
 */
const sourceCondition = (source: BudgetSource, params: any[], column = 'source'): string => {
    if (source === 'all') {
        return '';
    }
    params.push(source);
    return ` AND ${column} = $${params.length}`;
};

/** Zeroed provenance bucket, so the client can render the split before any row exists. */
const emptySourceTotals = () => ({ expenses: 0, income: 0, entryCount: 0 });

// Get budget entries
router.get('/entries', async (req: AuthRequest, res) => {
    try {
        const { start_date, end_date, category, assigned_to } = req.query;

        let queryText = `SELECT be.*, fm.name as assigned_to_name, fm.color as assigned_to_color
            FROM budget_entries be
            LEFT JOIN family_members fm ON be.assigned_to = fm.id
            WHERE be.user_id = $1`;
        const params: any[] = [req.userId];

        if (start_date) {
            params.push(start_date);
            queryText += ` AND be.date >= $${params.length}`;
        }

        if (end_date) {
            params.push(end_date);
            queryText += ` AND be.date <= $${params.length}`;
        }

        if (category) {
            params.push(category);
            queryText += ` AND be.category = $${params.length}`;
        }

        if (assigned_to) {
            params.push(assigned_to);
            queryText += ` AND be.assigned_to = $${params.length}`;
        }

        queryText += ' ORDER BY be.date DESC';

        const result = await query(queryText, params);
        res.json({ success: true, data: result.rows.map(mapBudgetEntry) });
    } catch (error) {
        logger.error('budget.get_budget_entries_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Create budget entry
router.post('/entries', async (req: AuthRequest, res) => {
    try {
        const { category, amount, description, date, is_expense, assigned_to } = req.body;
        const parsedAmount = toOptionalNumber(amount);

        if (!category || parsedAmount === null || !date) {
            return res
                .status(400)
                .json({ success: false, error: 'category, amount and date are required' });
        }

        const result = await query(
            `INSERT INTO budget_entries (user_id, category, amount, description, date, is_expense, assigned_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [
                req.userId,
                category,
                parsedAmount,
                toNullIfEmpty(description),
                date,
                Boolean(is_expense),
                toNullIfEmpty(assigned_to),
            ],
        );

        // Re-fetch with JOIN to get member name/color
        const full = await query(
            `SELECT be.*, fm.name as assigned_to_name, fm.color as assigned_to_color
             FROM budget_entries be LEFT JOIN family_members fm ON be.assigned_to = fm.id
             WHERE be.id = $1`,
            [result.rows[0].id],
        );

        res.json({ success: true, data: mapBudgetEntry(full.rows[0]) });
    } catch (error) {
        logger.error('budget.create_budget_entry_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Update budget entry
router.put('/entries/:id', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const { category, amount, description, date, is_expense, assigned_to } = req.body;
        const parsedAmount = amount !== undefined ? toOptionalNumber(amount) : undefined;

        if (amount !== undefined && parsedAmount === null) {
            return res.status(400).json({ success: false, error: 'Invalid amount format' });
        }

        // Handle assigned_to: allow explicit null to unassign
        const assignedToValue = assigned_to === '' || assigned_to === null ? null : assigned_to;

        const result = await query(
            `UPDATE budget_entries
       SET category = COALESCE($1, category),
           amount = COALESCE($2, amount),
           description = COALESCE($3, description),
           date = COALESCE($4, date),
           is_expense = COALESCE($5, is_expense),
           assigned_to = $6
       WHERE id = $7 AND user_id = $8 RETURNING *`,
            [
                toNullIfEmpty(category),
                parsedAmount,
                toNullIfEmpty(description),
                toNullIfEmpty(date),
                is_expense !== undefined ? Boolean(is_expense) : undefined,
                assignedToValue !== undefined ? assignedToValue : null,
                id,
                req.userId,
            ],
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Budget entry not found' });
        }

        // Re-fetch with JOIN
        const full = await query(
            `SELECT be.*, fm.name as assigned_to_name, fm.color as assigned_to_color
             FROM budget_entries be LEFT JOIN family_members fm ON be.assigned_to = fm.id
             WHERE be.id = $1`,
            [id],
        );

        res.json({ success: true, data: mapBudgetEntry(full.rows[0]) });
    } catch (error) {
        logger.error('budget.update_budget_entry_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Delete budget entry
router.delete('/entries/:id', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            'DELETE FROM budget_entries WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.userId],
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Budget entry not found' });
        }

        res.json({ success: true, message: 'Budget entry deleted' });
    } catch (error) {
        logger.error('budget.delete_budget_entry_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Get budget limits
router.get('/limits', async (req: AuthRequest, res) => {
    try {
        const { month, year } = req.query;

        let queryText = 'SELECT * FROM budget_limits WHERE user_id = $1';
        const params: any[] = [req.userId];

        if (month) {
            params.push(month);
            queryText += ` AND month = $${params.length}`;
        }

        if (year) {
            params.push(year);
            queryText += ` AND year = $${params.length}`;
        }

        const result = await query(queryText, params);
        res.json({ success: true, data: result.rows.map(mapBudgetLimit) });
    } catch (error) {
        logger.error('budget.get_budget_limits_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Set budget limit
router.post('/limits', async (req: AuthRequest, res) => {
    try {
        const { category, monthly_limit, month, year } = req.body;
        const parsedLimit = toOptionalNumber(monthly_limit);
        const parsedMonth = toOptionalNumber(month);
        const parsedYear = toOptionalNumber(year);

        if (!category || parsedLimit === null || parsedMonth === null || parsedYear === null) {
            return res.status(400).json({
                success: false,
                error: 'category, monthly_limit, month and year are required',
            });
        }

        const result = await query(
            `INSERT INTO budget_limits (user_id, category, monthly_limit, month, year)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, category, month, year)
       DO UPDATE SET monthly_limit = $3
       RETURNING *`,
            [req.userId, category, parsedLimit, parsedMonth, parsedYear],
        );

        res.json({ success: true, data: mapBudgetLimit(result.rows[0]) });
    } catch (error) {
        logger.error('budget.set_budget_limit_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Get budget statistics
//
// `source` narrows every figure to one provenance ('statement' = lines a
// confirmed bank statement created, 'manual' = hand-typed). `bySource` is
// deliberately computed WITHOUT that filter: the split has to stay visible
// while the user is looking at one side of it, otherwise the filter hides the
// very imbalance it exists to reveal.
router.get(
    '/statistics',
    validate({ query: budgetStatisticsQuerySchema }),
    async (req: AuthRequest, res) => {
        try {
            const {
                month: parsedMonth,
                year: parsedYear,
                source,
            } = req.query as unknown as { month: number; year: number; source: BudgetSource };

            const categoryParams: any[] = [req.userId, parsedMonth, parsedYear];
            const result = await query(
                `SELECT
         category,
         SUM(amount) as category_total
       FROM budget_entries
       WHERE user_id = $1
         AND is_expense = true
         AND EXTRACT(MONTH FROM date) = $2
         AND EXTRACT(YEAR FROM date) = $3${sourceCondition(source, categoryParams)}
       GROUP BY category`,
                categoryParams,
            );

            const totalsParams: any[] = [req.userId, parsedMonth, parsedYear];
            const totals = await query(
                `SELECT
         SUM(amount) FILTER (WHERE is_expense = true) as total_expenses,
         SUM(amount) FILTER (WHERE is_expense = false) as total_income
       FROM budget_entries
       WHERE user_id = $1
         AND EXTRACT(MONTH FROM date) = $2
         AND EXTRACT(YEAR FROM date) = $3${sourceCondition(source, totalsParams)}`,
                totalsParams,
            );

            // Per-member spending breakdown by category (for stacked bar chart)
            const memberParams: any[] = [req.userId, parsedMonth, parsedYear];
            const byMember = await query(
                `SELECT
         fm.id as assigned_to,
         fm.name as member_name,
         fm.color as member_color,
         be.category,
         SUM(be.amount) as amount
       FROM budget_entries be
       INNER JOIN family_members fm ON be.assigned_to = fm.id
       WHERE be.user_id = $1
         AND be.is_expense = true
         AND EXTRACT(MONTH FROM be.date) = $2
         AND EXTRACT(YEAR FROM be.date) = $3${sourceCondition(source, memberParams, 'be.source')}
       GROUP BY fm.id, fm.name, fm.color, be.category
       ORDER BY fm.name, be.category`,
                memberParams,
            );

            const sourceTotals = await query(
                `SELECT
         source,
         SUM(amount) FILTER (WHERE is_expense = true) as expenses,
         SUM(amount) FILTER (WHERE is_expense = false) as income,
         COUNT(*)::int as entry_count
       FROM budget_entries
       WHERE user_id = $1
         AND EXTRACT(MONTH FROM date) = $2
         AND EXTRACT(YEAR FROM date) = $3
       GROUP BY source`,
                [req.userId, parsedMonth, parsedYear],
            );

            const bySource: Record<string, ReturnType<typeof emptySourceTotals>> = {
                statement: emptySourceTotals(),
                manual: emptySourceTotals(),
            };
            for (const row of sourceTotals.rows) {
                // An unknown source value (a future importer) gets its own
                // bucket rather than being folded into 'manual' and quietly
                // misattributed.
                const key = String(row.source || 'manual');
                bySource[key] = {
                    expenses: toNumber(row.expenses),
                    income: toNumber(row.income),
                    entryCount: toNumber(row.entry_count),
                };
            }

            const totalExpenses = parseFloat(totals.rows[0]?.total_expenses || '0');
            const totalIncome = parseFloat(totals.rows[0]?.total_income || '0');

            res.json({
                success: true,
                data: {
                    source,
                    totalExpenses,
                    totalIncome,
                    balance: totalIncome - totalExpenses,
                    bySource,
                    byCategory: result.rows.map((row) => ({
                        category: row.category,
                        category_total: toNumber(row.category_total),
                    })),
                    byMember: byMember.rows.map((row) => ({
                        assigned_to: row.assigned_to,
                        member_name: row.member_name,
                        member_color: row.member_color,
                        category: row.category,
                        amount: toNumber(row.amount),
                    })),
                },
            });
        } catch (error) {
            logger.error('budget.get_budget_statistics_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

// Get monthly budget statistics for a year
//
// Each month also carries its expenses split by provenance, which is what
// turns the yearly chart into a coverage story: a month whose bar is almost
// entirely 'manual' is a month whose statements were never imported.
router.get(
    '/statistics/monthly',
    validate({ query: budgetMonthlyStatisticsQuerySchema }),
    async (req: AuthRequest, res) => {
        try {
            const { year: parsedYear, source } = req.query as unknown as {
                year: number;
                source: BudgetSource;
            };

            const params: any[] = [req.userId, parsedYear];
            const result = await query(
                `SELECT
         EXTRACT(MONTH FROM date)::int as month,
         SUM(amount) FILTER (WHERE is_expense = true) as total_expenses,
         SUM(amount) FILTER (WHERE is_expense = false) as total_income,
         SUM(amount) FILTER (WHERE is_expense = true AND source = 'statement')
           as statement_expenses,
         SUM(amount) FILTER (WHERE is_expense = true AND source <> 'statement')
           as manual_expenses
       FROM budget_entries
       WHERE user_id = $1
         AND EXTRACT(YEAR FROM date) = $2${sourceCondition(source, params)}
       GROUP BY EXTRACT(MONTH FROM date)
       ORDER BY month`,
                params,
            );

            const monthlyData = Array.from({ length: 12 }, (_, i) => {
                const monthNum = i + 1;
                const row = result.rows.find((r) => r.month === monthNum);
                return {
                    month: monthNum,
                    totalExpenses: row ? toNumber(row.total_expenses) : 0,
                    totalIncome: row ? toNumber(row.total_income) : 0,
                    statementExpenses: row ? toNumber(row.statement_expenses) : 0,
                    manualExpenses: row ? toNumber(row.manual_expenses) : 0,
                    balance: row ? toNumber(row.total_income) - toNumber(row.total_expenses) : 0,
                };
            });

            res.json({ success: true, data: monthlyData });
        } catch (error) {
            logger.error('budget.get_monthly_budget_statistics_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

export default router;
