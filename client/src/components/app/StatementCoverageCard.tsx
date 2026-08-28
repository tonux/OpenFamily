import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, CircleSlash, FileText, Loader2, Upload } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Badge, Button, Card, CardContent } from '../ui';
import { useDateLocale } from '../../lib/dateLocale';
import { useCurrency } from '../../lib/useCurrency';

// =============================================================================
// StatementCoverageCard
//
// Sits at the top of the Budget → Statistiques tab and answers the question
// the charts below it cannot: are these numbers backed by a bank statement, or
// only by what somebody remembered to type in?
//
// It reads /api/statements/coverage, which reconciles statement periods (that
// close mid-month) against the calendar month the page is showing. Three
// things get surfaced, in order of how badly they distort a total:
//
//   * an account with no statement at all for the month — the month is
//     under-counted by however much that card was used;
//   * an account only partly covered, with the missing days named;
//   * money sitting in an imported-but-unconfirmed statement, which no total
//     on the page counts yet.
// =============================================================================

export interface CoverageRange {
    start: string;
    end: string;
}

export interface CoverageAccount {
    key: string;
    issuer: string | null;
    account_label: string | null;
    card_last4: string | null;
    currency: string;
    status: 'covered' | 'partial' | 'missing';
    covered_days: number;
    missing_ranges: CoverageRange[];
    last_statement_date: string | null;
    unknown_period_count: number;
    pending_count: number;
    pending_amount: number;
    statements: Array<{
        id: string;
        status: string;
        statement_date: string | null;
        pending_count: number;
        pending_amount: number;
    }>;
}

export interface CoverageData {
    month: number;
    year: number;
    month_start: string;
    month_end: string;
    days_in_month: number;
    accounts: CoverageAccount[];
    total_accounts: number;
    covered_accounts: number;
    partial_accounts: number;
    missing_accounts: number;
    pending_count: number;
    pending_amount: number;
}

interface Props {
    data: CoverageData | null;
    loading: boolean;
    /** Switches the Budget page to the Relevés tab. */
    onOpenStatements: () => void;
}

const STATUS_META = {
    covered: { icon: CheckCircle2, tone: 'text-success', badge: 'success' as const },
    partial: { icon: AlertTriangle, tone: 'text-warning', badge: 'warning' as const },
    missing: { icon: CircleSlash, tone: 'text-destructive', badge: 'danger' as const },
};

export const StatementCoverageCard: React.FC<Props> = ({ data, loading, onOpenStatements }) => {
    const { t } = useTranslation();
    const locale = useDateLocale();
    const { format: formatMoney } = useCurrency();

    const day = (iso: string) => format(parseISO(iso), 'd MMM', { locale });

    const accountName = (account: CoverageAccount) => {
        const parts = [account.issuer, account.account_label].filter(Boolean).join(' · ');
        const last4 = account.card_last4 ? ` ····${account.card_last4}` : '';
        return (parts || t('budget.stats.coverage.unknown_account')) + last4;
    };

    if (loading) {
        return (
            <Card>
                <CardContent className="flex items-center gap-2 p-4 text-body-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('budget.stats.coverage.loading')}
                </CardContent>
            </Card>
        );
    }

    if (!data) {
        return null;
    }

    // No account has ever produced a statement: the whole budget is hand-typed,
    // which is precisely the situation the import exists to end.
    if (data.total_accounts === 0) {
        return (
            <Card className="border-dashed border-primary/40 bg-primary/5">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <p className="text-caption font-semibold text-foreground">
                            {t('budget.stats.coverage.empty_title')}
                        </p>
                        <p className="text-label-sm text-muted-foreground">
                            {t('budget.stats.coverage.empty_body')}
                        </p>
                    </div>
                    <Button type="button" onClick={onOpenStatements} className="shrink-0">
                        <Upload className="mr-2 h-4 w-4" />
                        {t('budget.stats.coverage.import')}
                    </Button>
                </CardContent>
            </Card>
        );
    }

    const incomplete = data.missing_accounts + data.partial_accounts;

    return (
        <Card
            className={
                incomplete > 0 || data.pending_count > 0 ? 'border-warning/40' : 'border-success/30'
            }
        >
            <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="flex items-center gap-2 text-caption font-semibold text-foreground">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            {t('budget.stats.coverage.title')}
                        </p>
                        <p className="text-label-sm text-muted-foreground">
                            {incomplete === 0
                                ? t('budget.stats.coverage.summary_complete', {
                                      count: data.total_accounts,
                                  })
                                : t('budget.stats.coverage.summary_incomplete', {
                                      covered: data.covered_accounts,
                                      total: data.total_accounts,
                                  })}
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={onOpenStatements}
                        className="shrink-0"
                    >
                        {t('budget.stats.coverage.open')}
                    </Button>
                </div>

                {/* Money the user can see on a statement but that no total below
                    counts yet — the single largest silent gap. */}
                {data.pending_count > 0 && (
                    <button
                        type="button"
                        onClick={onOpenStatements}
                        className="flex w-full items-start gap-2 rounded-input border border-warning/30 bg-warning/10 p-3 text-left text-body-sm transition-colors hover:bg-warning/15"
                    >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                        <span>
                            <span className="font-medium">
                                {t('budget.stats.coverage.pending_title', {
                                    amount: formatMoney(data.pending_amount),
                                })}
                            </span>
                            <span className="block text-muted-foreground">
                                {t('budget.stats.coverage.pending_body', {
                                    count: data.pending_count,
                                })}
                            </span>
                        </span>
                    </button>
                )}

                <ul className="divide-y divide-border">
                    {data.accounts.map((account) => {
                        const meta = STATUS_META[account.status];
                        const Icon = meta.icon;
                        return (
                            <li
                                key={account.key}
                                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                            >
                                <Icon className={`h-4 w-4 shrink-0 ${meta.tone}`} />
                                <span className="min-w-0 flex-1 truncate text-body-sm font-medium">
                                    {accountName(account)}
                                </span>
                                <Badge variant={meta.badge}>
                                    {t(`budget.stats.coverage.status.${account.status}`)}
                                </Badge>
                                <span className="w-full pl-7 text-label text-muted-foreground sm:w-auto sm:pl-0">
                                    {account.status === 'covered'
                                        ? t('budget.stats.coverage.days_full', {
                                              days: account.covered_days,
                                          })
                                        : account.status === 'partial'
                                          ? t('budget.stats.coverage.days_partial', {
                                                days: account.covered_days,
                                                total: data.days_in_month,
                                                gaps: account.missing_ranges
                                                    .map((r) =>
                                                        r.start === r.end
                                                            ? day(r.start)
                                                            : `${day(r.start)} – ${day(r.end)}`,
                                                    )
                                                    .join(', '),
                                            })
                                          : account.last_statement_date
                                            ? t('budget.stats.coverage.last_seen', {
                                                  date: day(account.last_statement_date),
                                              })
                                            : t('budget.stats.coverage.never_seen')}
                                </span>
                                {account.unknown_period_count > 0 && (
                                    <span className="w-full pl-7 text-label text-warning sm:w-auto sm:pl-0">
                                        {t('budget.stats.coverage.unknown_period', {
                                            count: account.unknown_period_count,
                                        })}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </CardContent>
        </Card>
    );
};
