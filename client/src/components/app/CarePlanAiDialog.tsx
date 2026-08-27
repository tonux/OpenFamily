import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Loader2, PiggyBank, Sparkles, Target, Wrench } from 'lucide-react';
import { Badge, Button, Dialog, Input } from '../ui';
import {
    priorityVariant,
    useCreateCareTasksBulk,
    useGenerateCarePlan,
    type CarePlanTask,
    type HouseCarePlan,
} from '../../hooks/useHouseCare';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * The AI plan is a PROPOSAL, never a write. The user reviews every suggested
 * task, unchecks what doesn't apply, and only then does it get created — same
 * human-in-the-loop contract as the receipt and garden scanners. A maintenance
 * task that silently appears in someone's calendar with a wrong recurrence is
 * worse than no suggestion at all.
 */
export const CarePlanAiDialog: React.FC<Props> = ({ open, onOpenChange }) => {
    const { t } = useTranslation();
    const generate = useGenerateCarePlan();
    const bulkCreate = useCreateCareTasksBulk();

    const [plan, setPlan] = useState<HouseCarePlan | null>(null);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [focus, setFocus] = useState('');
    const [error, setError] = useState('');
    const [added, setAdded] = useState(0);

    useEffect(() => {
        if (open) return;
        setPlan(null);
        setSelected(new Set());
        setError('');
        setAdded(0);
    }, [open]);

    const run = async () => {
        setError('');
        setPlan(null);
        setAdded(0);
        try {
            const result = await generate.mutateAsync({ focus: focus.trim() || undefined });
            setPlan(result.plan);
            // Everything pre-checked: the model was told to only propose what's
            // missing, so the common case is "accept all".
            setSelected(new Set(result.plan.tasks.map((_, i) => i)));
        } catch (err) {
            setError(err instanceof Error ? err.message : t('house.care.ai.planFailed'));
        }
    };

    const toggle = (index: number) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    };

    const accept = async () => {
        if (!plan) return;
        setError('');
        const chosen: CarePlanTask[] = plan.tasks.filter((_, i) => selected.has(i));
        if (chosen.length === 0) return;
        try {
            const created = await bulkCreate.mutateAsync(
                chosen.map((task) => ({
                    title: task.title,
                    category: task.category,
                    season: task.season,
                    frequency: task.frequency,
                    interval_months: task.intervalMonths,
                    month_start: task.monthStart,
                    month_end: task.monthEnd,
                    priority: task.priority,
                    responsibility: task.responsibility,
                    estimated_minutes: task.estimatedMinutes,
                    estimated_cost: task.estimatedCost,
                    risk_if_skipped: task.riskIfSkipped || null,
                    steps: task.steps,
                })),
            );
            setAdded(created.length);
            setPlan(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('house.common.saveError'));
        }
    };

    const loading = generate.isPending;

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={t('house.care.ai.planTitle')}
            description={t('house.care.ai.planDescription')}
            className="sm:max-w-3xl"
        >
            <div className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                            {t('house.care.ai.focusLabel')}
                        </label>
                        <Input
                            value={focus}
                            onChange={(e) => setFocus(e.target.value)}
                            placeholder={t('house.care.ai.focusPlaceholder')}
                        />
                    </div>
                    <Button type="button" onClick={run} disabled={loading} className="sm:w-auto">
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                {t('house.care.ai.generating')}
                            </>
                        ) : (
                            <>
                                <Sparkles className="mr-2 h-4 w-4" />
                                {t('house.care.ai.generate')}
                            </>
                        )}
                    </Button>
                </div>

                {loading && (
                    <div className="flex flex-col items-center justify-center py-10">
                        <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary" />
                        <p className="text-body text-muted-foreground">
                            {t('house.care.ai.generatingLong')}
                        </p>
                    </div>
                )}

                {error && !loading && (
                    <div className="flex items-start gap-2 rounded-input border border-warning/30 bg-warning-soft px-4 py-3 text-caption text-warning">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {added > 0 && (
                    <div className="flex items-start gap-2 rounded-input border border-success/30 bg-success-soft px-4 py-3 text-caption text-success">
                        <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>{t('house.care.ai.added', { count: added })}</span>
                    </div>
                )}

                {plan && !loading && (
                    <>
                        {plan.summary && (
                            <section className="rounded-card border border-border bg-card p-4">
                                <p className="text-caption text-foreground">{plan.summary}</p>
                            </section>
                        )}

                        {plan.priorities.length > 0 && (
                            <section className="rounded-card border border-primary/30 bg-primary/5 p-4">
                                <h4 className="mb-3 flex items-center gap-2 text-body font-semibold text-foreground">
                                    <Target className="h-4 w-4 text-primary" />
                                    {t('house.care.ai.priorities')}
                                </h4>
                                <ol className="space-y-3">
                                    {plan.priorities.map((p, i) => (
                                        <li key={i} className="flex items-start gap-3">
                                            <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-label-sm font-semibold text-primary-foreground">
                                                {i + 1}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="text-caption font-semibold text-foreground">
                                                    {p.title}
                                                </p>
                                                <p className="text-label-sm text-muted-foreground">
                                                    {p.why}
                                                </p>
                                                {p.when && (
                                                    <p className="mt-0.5 text-micro text-primary">
                                                        {p.when}
                                                    </p>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            </section>
                        )}

                        {plan.tasks.length > 0 && (
                            <section>
                                <div className="mb-3 flex items-center justify-between">
                                    <h4 className="flex items-center gap-2 text-body font-semibold text-foreground">
                                        <Wrench className="h-4 w-4" />
                                        {t('house.care.ai.proposedTasks')}
                                    </h4>
                                    <span className="text-micro text-muted-foreground">
                                        {t('house.care.ai.selectedCount', {
                                            selected: selected.size,
                                            total: plan.tasks.length,
                                        })}
                                    </span>
                                </div>
                                <ul className="space-y-2">
                                    {plan.tasks.map((task, i) => (
                                        <li
                                            key={i}
                                            className={`rounded-card border p-3 transition-colors ${
                                                selected.has(i)
                                                    ? 'border-primary/40 bg-card'
                                                    : 'border-border bg-surface-2/40 opacity-60'
                                            }`}
                                        >
                                            <label className="flex cursor-pointer items-start gap-3">
                                                <input
                                                    type="checkbox"
                                                    className="mt-1 h-4 w-4 flex-shrink-0 accent-[var(--color-primary)]"
                                                    checked={selected.has(i)}
                                                    onChange={() => toggle(i)}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-caption font-semibold text-foreground">
                                                        {task.title}
                                                    </p>
                                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                                        <Badge
                                                            variant={priorityVariant(task.priority)}
                                                        >
                                                            {task.priority}
                                                        </Badge>
                                                        <Badge variant="secondary">
                                                            {task.category}
                                                        </Badge>
                                                        <Badge variant="default">
                                                            {task.frequency}
                                                        </Badge>
                                                        {task.responsibility ===
                                                            'Professionnel' && (
                                                            <Badge variant="warning">
                                                                {task.responsibility}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    {task.riskIfSkipped && (
                                                        <p className="mt-2 flex items-start gap-1.5 text-micro text-muted-foreground">
                                                            <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-warning" />
                                                            {task.riskIfSkipped}
                                                        </p>
                                                    )}
                                                    {task.steps.length > 0 && (
                                                        <ul className="mt-2 space-y-0.5">
                                                            {task.steps.map((s, si) => (
                                                                <li
                                                                    key={si}
                                                                    className="text-micro text-muted-foreground"
                                                                >
                                                                    · {s}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                            </label>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {(plan.budget.yearlyProvision || plan.budget.rationale) && (
                            <section className="rounded-card border border-info/30 bg-info-soft/40 p-4">
                                <h4 className="mb-1.5 flex items-center gap-2 text-body font-semibold text-info">
                                    <PiggyBank className="h-4 w-4" />
                                    {t('house.care.ai.budget')}
                                </h4>
                                {plan.budget.yearlyProvision != null && (
                                    <p className="text-h2 font-semibold text-foreground">
                                        {Math.round(plan.budget.yearlyProvision).toLocaleString()} $
                                        <span className="ml-1 text-caption font-normal text-muted-foreground">
                                            {t('house.care.ai.perYear')}
                                        </span>
                                    </p>
                                )}
                                <p className="mt-1 text-caption text-foreground">
                                    {plan.budget.rationale}
                                </p>
                            </section>
                        )}

                        {plan.watchouts.length > 0 && (
                            <section className="rounded-card border border-warning/30 bg-warning-soft/40 p-4">
                                <h4 className="mb-2 flex items-center gap-2 text-body font-semibold text-warning">
                                    <AlertTriangle className="h-4 w-4" />
                                    {t('house.care.ai.watchouts')}
                                </h4>
                                <ul className="space-y-1.5">
                                    {plan.watchouts.map((w, i) => (
                                        <li
                                            key={i}
                                            className="flex items-start gap-2 text-caption text-foreground"
                                        >
                                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" />
                                            {w}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                    </>
                )}

                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        {t('garden.common.close', { defaultValue: 'Fermer' })}
                    </Button>
                    {plan && plan.tasks.length > 0 && (
                        <Button
                            onClick={accept}
                            disabled={selected.size === 0 || bulkCreate.isPending}
                        >
                            {bulkCreate.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Check className="mr-2 h-4 w-4" />
                            )}
                            {t('house.care.ai.addSelected', { count: selected.size })}
                        </Button>
                    )}
                </div>
            </div>
        </Dialog>
    );
};

export default CarePlanAiDialog;
