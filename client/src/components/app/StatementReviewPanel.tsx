import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, Loader2, AlertTriangle, EyeOff, Eye, Copy, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardContent, Input, Select } from '../ui';

// =============================================================================
// StatementReviewPanel
//
// The human-in-the-loop step. Everything the model produced is editable here,
// and nothing reaches budget_entries until "Confirmer" is pressed.
//
// Design decision worth stating: edits save on blur, one PATCH per field, with
// optimistic local state. A "save all" button would be cheaper in requests but
// invites the failure where a user edits forty rows, navigates away, and loses
// the lot. Per-field saves make partial work durable, which is what someone
// correcting a long statement actually needs.
//
// Rows the import auto-excluded (card payments, cross-statement duplicates)
// are shown, not hidden — greyed and one click from being restored. Hiding
// them would make the totals inexplicable.
// =============================================================================

export interface StatementTransaction {
    id: string;
    line_no: number;
    transaction_date: string;
    posted_date: string | null;
    description: string;
    merchant: string | null;
    amount: number;
    is_expense: boolean;
    category: string;
    confidence: 'high' | 'medium' | 'low';
    status: 'pending' | 'imported' | 'ignored' | 'duplicate';
    assigned_to: string | null;
    assigned_to_name?: string | null;
}

export interface StatementDetail {
    id: string;
    status: 'pending_review' | 'imported' | 'failed';
    issuer: string | null;
    account_label: string | null;
    card_last4: string | null;
    currency: string;
    statement_date: string | null;
    period_start: string | null;
    period_end: string | null;
    previous_balance: number | null;
    new_balance: number | null;
    total_purchases: number | null;
    total_payments: number | null;
    minimum_due: number | null;
    due_date: string | null;
    credit_limit: number | null;
    interest_rate_purchases: number | null;
    reconciliation_delta: number | null;
    warnings: string[];
    transaction_count: number;
    pending_count: number;
    imported_count: number;
    ignored_count: number;
    duplicate_count: number;
}

interface Props {
    statementId: string;
    categories: string[];
    familyMembers: Array<{ id: string; name: string }>;
    onBack: () => void;
    /** Fired after a successful confirm so the parent can refetch the budget. */
    onConfirmed: () => void;
    onDeleted: () => void;
}

const STATUS_VARIANT: Record<
    StatementTransaction['status'],
    'default' | 'success' | 'warning' | 'secondary'
> = {
    pending: 'default',
    imported: 'success',
    ignored: 'secondary',
    duplicate: 'warning',
};

export const StatementReviewPanel: React.FC<Props> = ({
    statementId,
    categories,
    familyMembers,
    onBack,
    onConfirmed,
    onDeleted,
}) => {
    const { t } = useTranslation();
    const [statement, setStatement] = useState<StatementDetail | null>(null);
    const [rows, setRows] = useState<StatementTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'pending' | 'excluded'>('all');
    const [savingId, setSavingId] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get<{
                success: boolean;
                data: { statement: StatementDetail; transactions: StatementTransaction[] };
            }>(`/api/statements/${statementId}`);
            setStatement(res.data.statement);
            setRows(res.data.transactions);
        } catch {
            setError(t('statements.review.load_error'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statementId]);

    const money = (v: number | null) =>
        v === null
            ? '—'
            : new Intl.NumberFormat('fr-CA', {
                  style: 'currency',
                  currency: statement?.currency || 'CAD',
                  maximumFractionDigits: 2,
              }).format(v);

    const patchRow = async (id: string, patch: Partial<StatementTransaction>) => {
        const before = rows.find((r) => r.id === id);
        if (!before) return;
        // Optimistic: the table stays responsive while the request is in flight,
        // and a failure rolls the single field back rather than the whole table.
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
        setSavingId(id);
        try {
            await api.patch(`/api/statements/${statementId}/transactions/${id}`, patch);
        } catch {
            setRows((prev) => prev.map((r) => (r.id === id ? before : r)));
            setError(t('statements.review.save_error'));
        } finally {
            setSavingId(null);
        }
    };

    const bulk = async (ids: string[], patch: { status?: string; category?: string }) => {
        if (ids.length === 0) return;
        try {
            await api.patch(`/api/statements/${statementId}/transactions`, {
                transaction_ids: ids,
                ...patch,
            });
            await load();
        } catch {
            setError(t('statements.review.save_error'));
        }
    };

    const confirm = async () => {
        setConfirming(true);
        setError(null);
        try {
            await api.post(`/api/statements/${statementId}/confirm`, {
                include_duplicates: false,
            });
            await load();
            onConfirmed();
        } catch {
            setError(t('statements.review.confirm_error'));
        } finally {
            setConfirming(false);
        }
    };

    const remove = async (withEntries: boolean) => {
        if (!window.confirm(t('statements.review.delete_confirm'))) return;
        try {
            await api.delete(
                `/api/statements/${statementId}?with_entries=${withEntries ? 'true' : 'false'}`,
            );
            onDeleted();
        } catch {
            setError(t('statements.review.delete_error'));
        }
    };

    const visible = useMemo(() => {
        if (filter === 'pending') return rows.filter((r) => r.status === 'pending');
        if (filter === 'excluded')
            return rows.filter((r) => r.status === 'ignored' || r.status === 'duplicate');
        return rows;
    }, [rows, filter]);

    const pendingTotal = useMemo(
        () =>
            rows
                .filter((r) => r.status === 'pending' && r.is_expense)
                .reduce((sum, r) => sum + r.amount, 0),
        [rows],
    );
    const pendingIds = rows.filter((r) => r.status === 'pending').map((r) => r.id);

    const categoryOptions = useMemo(
        () =>
            [...new Set([...categories, ...rows.map((r) => r.category)])]
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b))
                .map((c) => ({ value: c, label: c })),
        [categories, rows],
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('statements.review.loading')}
            </div>
        );
    }

    if (!statement) {
        return (
            <div className="space-y-4">
                <Button variant="secondary" onClick={onBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {t('common.back')}
                </Button>
                <p className="text-danger">{error ?? t('statements.review.load_error')}</p>
            </div>
        );
    }

    const allImported = statement.pending_count === 0;

    return (
        <div className="space-y-4">
            {/* ------------------------------- header ------------------------------ */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Button variant="secondary" onClick={onBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {t('common.back')}
                </Button>
                <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => void remove(false)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('statements.review.delete')}
                    </Button>
                    <Button onClick={() => void confirm()} disabled={confirming || allImported}>
                        {confirming ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Check className="mr-2 h-4 w-4" />
                        )}
                        {allImported
                            ? t('statements.review.already_imported')
                            : t('statements.review.confirm', {
                                  count: statement.pending_count,
                              })}
                    </Button>
                </div>
            </div>

            <Card>
                <CardContent className="p-4">
                    <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <h3 className="text-base font-semibold">
                            {[statement.issuer, statement.account_label]
                                .filter(Boolean)
                                .join(' · ') || t('statements.unknown_issuer')}
                        </h3>
                        {statement.card_last4 && (
                            <span className="text-caption text-muted-foreground">
                                ····{statement.card_last4}
                            </span>
                        )}
                        <Badge variant={statement.status === 'imported' ? 'success' : 'default'}>
                            {t(`statements.status.${statement.status}`)}
                        </Badge>
                    </div>

                    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                        {(
                            [
                                [
                                    'period',
                                    statement.period_start && statement.period_end
                                        ? `${statement.period_start} → ${statement.period_end}`
                                        : (statement.statement_date ?? '—'),
                                ],
                                ['new_balance', money(statement.new_balance)],
                                ['minimum_due', money(statement.minimum_due)],
                                ['due_date', statement.due_date ?? '—'],
                                ['total_purchases', money(statement.total_purchases)],
                                ['total_payments', money(statement.total_payments)],
                                ['credit_limit', money(statement.credit_limit)],
                                [
                                    'interest_rate',
                                    statement.interest_rate_purchases !== null
                                        ? `${statement.interest_rate_purchases} %`
                                        : '—',
                                ],
                            ] as Array<[string, string]>
                        ).map(([key, value]) => (
                            <div key={key}>
                                <dt className="text-caption text-muted-foreground">
                                    {t(`statements.fields.${key}`)}
                                </dt>
                                <dd className="font-medium">{value}</dd>
                            </div>
                        ))}
                    </dl>

                    {statement.warnings?.length > 0 && (
                        <ul className="mt-3 space-y-1 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                            {statement.warnings.map((w, i) => (
                                <li key={i} className="flex items-start gap-2">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                                    <span>{w}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            {error && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                    {error}
                </div>
            )}

            {/* ------------------------------ toolbar ------------------------------ */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                    {(['all', 'pending', 'excluded'] as const).map((f) => (
                        <Button
                            key={f}
                            variant={filter === f ? 'secondary' : 'ghost'}
                            onClick={() => setFilter(f)}
                        >
                            {t(`statements.review.filter.${f}`)}
                        </Button>
                    ))}
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-caption text-muted-foreground">
                        {t('statements.review.pending_total', {
                            count: statement.pending_count,
                            total: money(pendingTotal),
                        })}
                    </span>
                    {pendingIds.length > 0 && (
                        <Button
                            variant="ghost"
                            onClick={() => void bulk(pendingIds, { status: 'ignored' })}
                        >
                            <EyeOff className="mr-2 h-4 w-4" />
                            {t('statements.review.ignore_all')}
                        </Button>
                    )}
                </div>
            </div>

            {/* ------------------------------- table ------------------------------- */}
            <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border bg-surface-2 text-left">
                            <th className="p-2 font-medium">{t('statements.table.date')}</th>
                            <th className="p-2 font-medium">{t('statements.table.description')}</th>
                            <th className="p-2 font-medium">{t('statements.table.category')}</th>
                            {familyMembers.length > 0 && (
                                <th className="p-2 font-medium">{t('statements.table.member')}</th>
                            )}
                            <th className="p-2 text-right font-medium">
                                {t('statements.table.amount')}
                            </th>
                            <th className="p-2 font-medium">{t('statements.table.status')}</th>
                            <th className="p-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {visible.length === 0 && (
                            <tr>
                                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                                    {t('statements.review.empty')}
                                </td>
                            </tr>
                        )}
                        {visible.map((row) => {
                            const muted = row.status === 'ignored' || row.status === 'duplicate';
                            const frozen = row.status === 'imported';
                            return (
                                <tr
                                    key={row.id}
                                    className={`border-b border-border/60 last:border-0 ${
                                        muted ? 'opacity-55' : ''
                                    }`}
                                >
                                    <td className="whitespace-nowrap p-2 tabular-nums">
                                        {row.transaction_date}
                                    </td>
                                    <td className="p-2">
                                        <span className="block max-w-[26ch] truncate sm:max-w-[40ch]">
                                            {row.merchant || row.description}
                                        </span>
                                        {row.confidence === 'low' && (
                                            <span className="text-caption text-warning">
                                                {t('statements.review.low_confidence')}
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-2">
                                        {frozen ? (
                                            <span>{row.category}</span>
                                        ) : (
                                            <Select
                                                value={row.category}
                                                onValueChange={(v) =>
                                                    void patchRow(row.id, { category: v })
                                                }
                                                options={categoryOptions}
                                                className="min-w-[9rem]"
                                            />
                                        )}
                                    </td>
                                    {familyMembers.length > 0 && (
                                        <td className="p-2">
                                            {frozen ? (
                                                <span>{row.assigned_to_name ?? '—'}</span>
                                            ) : (
                                                <Select
                                                    value={row.assigned_to ?? ''}
                                                    onValueChange={(v) =>
                                                        void patchRow(row.id, {
                                                            assigned_to: v || null,
                                                        })
                                                    }
                                                    options={[
                                                        {
                                                            value: '',
                                                            label: t('statements.table.nobody'),
                                                        },
                                                        ...familyMembers.map((m) => ({
                                                            value: m.id,
                                                            label: m.name,
                                                        })),
                                                    ]}
                                                    className="min-w-[8rem]"
                                                />
                                            )}
                                        </td>
                                    )}
                                    <td className="p-2 text-right">
                                        {frozen ? (
                                            <span
                                                className={`tabular-nums font-medium ${
                                                    row.is_expense ? 'text-danger' : 'text-success'
                                                }`}
                                            >
                                                {row.is_expense ? '−' : '+'}
                                                {money(row.amount)}
                                            </span>
                                        ) : (
                                            <Input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                defaultValue={row.amount.toFixed(2)}
                                                onBlur={(e) => {
                                                    const v = parseFloat(e.target.value);
                                                    if (
                                                        Number.isFinite(v) &&
                                                        v > 0 &&
                                                        Math.abs(v - row.amount) > 0.001
                                                    ) {
                                                        void patchRow(row.id, { amount: v });
                                                    }
                                                }}
                                                className="w-24 text-right tabular-nums"
                                            />
                                        )}
                                    </td>
                                    <td className="p-2">
                                        <Badge variant={STATUS_VARIANT[row.status]}>
                                            {row.status === 'duplicate' && (
                                                <Copy className="mr-1 inline h-3 w-3" />
                                            )}
                                            {t(`statements.tx_status.${row.status}`)}
                                        </Badge>
                                    </td>
                                    <td className="p-2 text-right">
                                        {savingId === row.id ? (
                                            <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />
                                        ) : (
                                            !frozen && (
                                                <Button
                                                    variant="ghost"
                                                    onClick={() =>
                                                        void patchRow(row.id, {
                                                            status:
                                                                row.status === 'pending'
                                                                    ? 'ignored'
                                                                    : 'pending',
                                                        })
                                                    }
                                                    title={
                                                        row.status === 'pending'
                                                            ? t('statements.review.ignore')
                                                            : t('statements.review.restore')
                                                    }
                                                >
                                                    {row.status === 'pending' ? (
                                                        <EyeOff className="h-4 w-4" />
                                                    ) : (
                                                        <Eye className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            )
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
