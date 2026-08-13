import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    FileText,
    Upload,
    Loader2,
    CalendarClock,
    CreditCard,
    TrendingDown,
    ChevronRight,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardContent } from '../ui';
import { StatementImportDialog } from './StatementImportDialog';
import { StatementReviewPanel, type StatementDetail } from './StatementReviewPanel';

// =============================================================================
// StatementsTab
//
// The "Relevés" tab of the Budget page. Two views behind one component:
// the list of imported statements plus the account header, and — once a
// statement is selected — the review table.
//
// The account header is the part a pile of budget_entries could never show:
// what is owed, by when, and how much of the credit line is used. It reads
// from /api/statements/overview, which returns the latest statement plus the
// balance history in one call.
// =============================================================================

// A list row carries exactly the statement fields the detail view uses;
// the alias keeps the intent readable without declaring an empty interface.
type StatementListItem = StatementDetail;

interface Overview {
    latest: StatementListItem | null;
    history: StatementListItem[];
    daysUntilDue: number | null;
    utilizationPercent: number | null;
    pendingReviewCount: number;
}

interface Props {
    categories: string[];
    familyMembers: Array<{ id: string; name: string }>;
    /** Called after a confirm or a delete so the parent reloads its budget data. */
    onBudgetChanged: () => void;
}

export const StatementsTab: React.FC<Props> = ({ categories, familyMembers, onBudgetChanged }) => {
    const { t } = useTranslation();
    const [importOpen, setImportOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [statements, setStatements] = useState<StatementListItem[]>([]);
    const [overview, setOverview] = useState<Overview | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [list, ov] = await Promise.all([
                api.get<{ success: boolean; data: StatementListItem[] }>('/api/statements'),
                api.get<{ success: boolean; data: Overview }>('/api/statements/overview'),
            ]);
            setStatements(list.data);
            setOverview(ov.data);
        } catch {
            setStatements([]);
            setOverview(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const currency = overview?.latest?.currency || statements[0]?.currency || 'CAD';
    const money = useCallback(
        (v: number | null | undefined) =>
            v === null || v === undefined
                ? '—'
                : new Intl.NumberFormat('fr-CA', {
                      style: 'currency',
                      currency,
                      maximumFractionDigits: 0,
                  }).format(v),
        [currency],
    );

    // The due-date banner escalates as the date approaches, and flips to an
    // outright alert once it is past. Silence above a week out: a reminder
    // shown every day for a month stops being read.
    const dueTone = useMemo<'none' | 'info' | 'warning' | 'danger'>(() => {
        const d = overview?.daysUntilDue;
        if (d === null || d === undefined || overview?.latest?.status === 'imported') {
            if (d === null || d === undefined) return 'none';
        }
        if (d === null || d === undefined) return 'none';
        if (d < 0) return 'danger';
        if (d <= 3) return 'danger';
        if (d <= 7) return 'warning';
        return 'none';
    }, [overview]);

    if (selectedId) {
        return (
            <StatementReviewPanel
                statementId={selectedId}
                categories={categories}
                familyMembers={familyMembers}
                onBack={() => {
                    setSelectedId(null);
                    void load();
                }}
                onConfirmed={() => {
                    onBudgetChanged();
                    void load();
                }}
                onDeleted={() => {
                    setSelectedId(null);
                    onBudgetChanged();
                    void load();
                }}
            />
        );
    }

    return (
        <div className="space-y-4">
            {/* ------------------------- due-date banner ------------------------- */}
            {dueTone !== 'none' && overview?.latest && (
                <div
                    className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
                        dueTone === 'danger'
                            ? 'border-danger/30 bg-danger/10'
                            : 'border-warning/30 bg-warning/10'
                    }`}
                >
                    <CalendarClock
                        className={`mt-0.5 h-5 w-5 shrink-0 ${
                            dueTone === 'danger' ? 'text-danger' : 'text-warning'
                        }`}
                    />
                    <div>
                        <p className="font-medium">
                            {(overview.daysUntilDue ?? 0) < 0
                                ? t('statements.due.overdue', {
                                      days: Math.abs(overview.daysUntilDue ?? 0),
                                  })
                                : t('statements.due.soon', { days: overview.daysUntilDue })}
                        </p>
                        <p className="text-muted-foreground">
                            {t('statements.due.detail', {
                                balance: money(overview.latest.new_balance),
                                minimum: money(overview.latest.minimum_due),
                                date: overview.latest.due_date ?? '—',
                            })}
                        </p>
                    </div>
                </div>
            )}

            {/* ---------------------------- KPI header --------------------------- */}
            {overview?.latest && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                        {
                            icon: CreditCard,
                            label: t('statements.kpi.balance'),
                            value: money(overview.latest.new_balance),
                            hint:
                                overview.utilizationPercent !== null
                                    ? t('statements.kpi.utilization', {
                                          percent: overview.utilizationPercent,
                                          limit: money(overview.latest.credit_limit),
                                      })
                                    : undefined,
                        },
                        {
                            icon: TrendingDown,
                            label: t('statements.kpi.purchases'),
                            value: money(overview.latest.total_purchases),
                            hint: overview.latest.statement_date ?? undefined,
                        },
                        {
                            icon: CalendarClock,
                            label: t('statements.kpi.minimum_due'),
                            value: money(overview.latest.minimum_due),
                            hint: overview.latest.due_date ?? undefined,
                        },
                        {
                            icon: FileText,
                            label: t('statements.kpi.statements'),
                            value: String(statements.length),
                            hint:
                                overview.pendingReviewCount > 0
                                    ? t('statements.kpi.pending_review', {
                                          count: overview.pendingReviewCount,
                                      })
                                    : undefined,
                        },
                    ].map(({ icon: Icon, label, value, hint }) => (
                        <Card key={label}>
                            <CardContent className="p-4">
                                <div className="mb-1 flex items-center gap-2 text-caption text-muted-foreground">
                                    <Icon className="h-4 w-4" />
                                    {label}
                                </div>
                                <p className="text-xl font-semibold tabular-nums">{value}</p>
                                {hint && (
                                    <p className="mt-1 text-caption text-muted-foreground">
                                        {hint}
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* ------------------------------ toolbar ---------------------------- */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">{t('statements.list.subtitle')}</p>
                <Button onClick={() => setImportOpen(true)}>
                    <Upload className="mr-2 h-4 w-4" />
                    {t('statements.list.import')}
                </Button>
            </div>

            {/* ------------------------------- list ------------------------------ */}
            {loading ? (
                <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('statements.list.loading')}
                </div>
            ) : statements.length === 0 ? (
                <Card>
                    <CardContent className="p-10 text-center">
                        <FileText className="mx-auto mb-3 h-12 w-12 text-muted-foreground opacity-50" />
                        <p className="mb-1 font-medium">{t('statements.list.empty_title')}</p>
                        <p className="mx-auto mb-4 max-w-md text-sm text-muted-foreground">
                            {t('statements.list.empty_body')}
                        </p>
                        <Button onClick={() => setImportOpen(true)}>
                            <Upload className="mr-2 h-4 w-4" />
                            {t('statements.list.import')}
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {statements.map((s) => (
                        <Card key={s.id}>
                            <CardContent className="p-0">
                                <button
                                    type="button"
                                    onClick={() => setSelectedId(s.id)}
                                    className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-surface-2"
                                >
                                    <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium">
                                                {s.statement_date ??
                                                    s.period_end ??
                                                    t('statements.unknown_date')}
                                            </span>
                                            <Badge
                                                variant={
                                                    s.status === 'imported' ? 'success' : 'default'
                                                }
                                            >
                                                {t(`statements.status.${s.status}`)}
                                            </Badge>
                                            {s.pending_count > 0 && (
                                                <Badge variant="warning">
                                                    {t('statements.list.to_review', {
                                                        count: s.pending_count,
                                                    })}
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="truncate text-caption text-muted-foreground">
                                            {[s.issuer, s.account_label]
                                                .filter(Boolean)
                                                .join(' · ') || t('statements.unknown_issuer')}
                                            {s.card_last4 ? ` ····${s.card_last4}` : ''}
                                            {' — '}
                                            {t('statements.list.transactions', {
                                                count: s.transaction_count,
                                            })}
                                        </p>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <p className="font-semibold tabular-nums">
                                            {money(s.total_purchases)}
                                        </p>
                                        <p className="text-caption text-muted-foreground">
                                            {t('statements.fields.total_purchases')}
                                        </p>
                                    </div>
                                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                </button>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <StatementImportDialog
                open={importOpen}
                onOpenChange={setImportOpen}
                onImported={(id) => {
                    setImportOpen(false);
                    setSelectedId(id);
                    void load();
                }}
            />
        </div>
    );
};
