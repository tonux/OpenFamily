import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AlertTriangle,
    CalendarClock,
    Check,
    ChevronDown,
    ChevronRight,
    Clock,
    Edit2,
    Home,
    Loader2,
    PiggyBank,
    Plus,
    Sparkles,
    Stethoscope,
    Trash2,
    TrendingDown,
    Wrench,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, Select } from '../ui';
import {
    CARE_CATEGORIES,
    CARE_SEASONS,
    daysUntilDue,
    priorityVariant,
    useCareOverview,
    useCareTasks,
    useCompleteCareTask,
    useDeleteCareTask,
    useSeedCarePlan,
    type CareCategory,
    type CareSeason,
    type CareTask,
} from '../../hooks/useHouseCare';
import { CareCompleteDialog } from './CareCompleteDialog';
import { CarePlanAiDialog } from './CarePlanAiDialog';
import { CareTaskDialog } from './CareTaskDialog';
import { HouseDiagnoseDialog } from './HouseDiagnoseDialog';
import { HouseProfileDialog } from './HouseProfileDialog';
import { WeeklyBriefingDialog } from './WeeklyBriefingDialog';

// =============================================================================
// "Entretien saisonnier" tab.
//
// Reading order matters more than feature count here: a first-time owner opens
// this and needs to know, in order, (1) what's late and dangerous, (2) the
// ten-minute tour to do this week, (3) what this season asks for, and (4) which
// five-figure expense is coming and what to set aside. Everything else — the
// full program, the filters — sits below that fold.
// =============================================================================

const CATEGORY_ICON: Record<string, React.ReactNode> = {
    Toiture: <Home className="h-3.5 w-3.5" />,
    'Gros postes': <PiggyBank className="h-3.5 w-3.5" />,
};

const dueLabel = (
    task: CareTask,
    t: ReturnType<typeof useTranslation>['t'],
): { text: string; tone: string } => {
    const days = daysUntilDue(task.next_due_on);
    if (days == null) return { text: t('house.care.noDate'), tone: 'text-muted-foreground' };
    if (days < 0)
        return {
            text: t('house.care.overdueBy', { count: Math.abs(days) }),
            tone: 'text-danger font-medium',
        };
    if (days === 0) return { text: t('house.care.dueToday'), tone: 'text-warning font-medium' };
    if (days <= 14) return { text: t('house.care.inDays', { count: days }), tone: 'text-warning' };
    return { text: t('house.care.inDays', { count: days }), tone: 'text-muted-foreground' };
};

interface TaskRowProps {
    task: CareTask;
    onComplete: (task: CareTask) => void;
    onEdit: (task: CareTask) => void;
    onDelete: (task: CareTask) => void;
}

/**
 * One task. Collapsed it shows what and when; expanded it shows the two things
 * that actually change behaviour — what it costs you to skip it, and the exact
 * steps, so "nettoyer les gouttières" isn't a task you postpone for lack of
 * knowing how.
 */
const TaskRow: React.FC<TaskRowProps> = ({ task, onComplete, onEdit, onDelete }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const due = dueLabel(task, t);

    return (
        <li className="rounded-card border border-border bg-card">
            <div className="flex items-start gap-3 p-3">
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="mt-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={t('house.care.toggleDetails')}
                >
                    {expanded ? (
                        <ChevronDown className="h-4 w-4" />
                    ) : (
                        <ChevronRight className="h-4 w-4" />
                    )}
                </button>

                <div className="min-w-0 flex-1">
                    <p className="text-caption font-semibold text-foreground">{task.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant={priorityVariant(task.priority)}>{task.priority}</Badge>
                        <Badge variant="secondary">
                            {CATEGORY_ICON[task.category] && (
                                <span className="mr-1 inline-flex">
                                    {CATEGORY_ICON[task.category]}
                                </span>
                            )}
                            {task.category}
                        </Badge>
                        <Badge variant="default">{task.frequency}</Badge>
                        {task.responsibility === 'Professionnel' && (
                            <Badge variant="warning">{task.responsibility}</Badge>
                        )}
                    </div>
                    <p className={`mt-1.5 flex items-center gap-3 text-micro ${due.tone}`}>
                        <span className="inline-flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" />
                            {due.text}
                        </span>
                        {task.estimated_minutes != null && (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {t('house.care.minutes', { count: task.estimated_minutes })}
                            </span>
                        )}
                        {task.last_done_on && (
                            <span className="text-muted-foreground">
                                {t('house.care.lastDone', { date: task.last_done_on })}
                            </span>
                        )}
                    </p>
                </div>

                <div className="flex flex-shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onComplete(task)}>
                        <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onEdit(task)}>
                        <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(task)}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {expanded && (
                <div className="space-y-3 border-t border-border px-3 py-3">
                    {task.risk_if_skipped && (
                        <div className="flex items-start gap-2 rounded-input border border-warning/30 bg-warning-soft/40 px-3 py-2">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" />
                            <div>
                                <p className="text-micro font-semibold text-warning">
                                    {t('house.care.riskLabel')}
                                </p>
                                <p className="text-caption text-foreground">
                                    {task.risk_if_skipped}
                                </p>
                            </div>
                        </div>
                    )}
                    {task.steps.length > 0 && (
                        <div>
                            <p className="mb-1.5 text-micro font-semibold text-muted-foreground">
                                {t('house.care.stepsLabel')}
                            </p>
                            <ol className="space-y-1">
                                {task.steps.map((s, i) => (
                                    <li key={i} className="flex items-start gap-2">
                                        <span className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-surface-2 text-micro text-muted-foreground">
                                            {i + 1}
                                        </span>
                                        <span className="text-caption text-foreground">{s}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}
                    {task.estimated_cost != null && (
                        <p className="text-micro text-muted-foreground">
                            {t('house.care.estimatedCost', {
                                amount: task.estimated_cost.toLocaleString(),
                            })}
                        </p>
                    )}
                </div>
            )}
        </li>
    );
};

export const HouseCareTab: React.FC = () => {
    const { t } = useTranslation();
    const { data: overview, isLoading } = useCareOverview();
    const seed = useSeedCarePlan();
    const complete = useCompleteCareTask();
    const deleteTask = useDeleteCareTask();

    const [profileOpen, setProfileOpen] = useState(false);
    const [planOpen, setPlanOpen] = useState(false);
    const [briefingOpen, setBriefingOpen] = useState(false);
    const [diagnoseOpen, setDiagnoseOpen] = useState(false);
    const [taskDialogOpen, setTaskDialogOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<CareTask | null>(null);
    const [completingTask, setCompletingTask] = useState<CareTask | null>(null);
    const [completeOpen, setCompleteOpen] = useState(false);

    const [seasonFilter, setSeasonFilter] = useState<CareSeason | ''>('');
    const [categoryFilter, setCategoryFilter] = useState<CareCategory | ''>('');

    const { data: allTasks } = useCareTasks({
        season: seasonFilter || undefined,
        category: categoryFilter || undefined,
    });

    const openComplete = (task: CareTask) => {
        setCompletingTask(task);
        setCompleteOpen(true);
    };

    const openEdit = (task: CareTask) => {
        setEditingTask(task);
        setTaskDialogOpen(true);
    };

    const handleDelete = async (task: CareTask) => {
        if (!confirm(t('house.care.deleteConfirm', { title: task.title }))) return;
        await deleteTask.mutateAsync(task.id);
    };

    /** Weekly tour: one tap ticks it, no dialog. Friction is what kills habits. */
    const tickWeekly = async (task: CareTask) => {
        if (task.done_this_week) return;
        await complete.mutateAsync({ id: task.id, body: { status: 'Fait' } });
    };

    const seasonOptions = useMemo(
        () => [
            { value: '', label: t('house.common.allFem') },
            ...CARE_SEASONS.map((s) => ({ value: s, label: s })),
        ],
        [t],
    );
    const categoryOptions = useMemo(
        () => [
            { value: '', label: t('house.common.all') },
            ...CARE_CATEGORIES.map((c) => ({ value: c, label: c })),
        ],
        [t],
    );

    if (isLoading) {
        return (
            <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    const counts = overview?.counts;
    const isEmpty = (counts?.total ?? 0) === 0;

    return (
        <div className="space-y-6">
            {/* Assistant bar — the AI entry points live at the top because they're
                the reason someone opens this tab on a random Tuesday. */}
            <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setBriefingOpen(true)}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    {t('house.care.actions.briefing')}
                </Button>
                <Button variant="secondary" onClick={() => setPlanOpen(true)}>
                    <Wrench className="mr-2 h-4 w-4" />
                    {t('house.care.actions.plan')}
                </Button>
                <Button variant="secondary" onClick={() => setDiagnoseOpen(true)}>
                    <Stethoscope className="mr-2 h-4 w-4" />
                    {t('house.care.actions.diagnose')}
                </Button>
                <div className="flex-1" />
                <Button variant="ghost" onClick={() => setProfileOpen(true)}>
                    <Home className="mr-2 h-4 w-4" />
                    {t('house.care.actions.profile')}
                </Button>
                <Button
                    variant="ghost"
                    onClick={() => {
                        setEditingTask(null);
                        setTaskDialogOpen(true);
                    }}
                >
                    <Plus className="mr-2 h-4 w-4" />
                    {t('house.care.actions.addTask')}
                </Button>
            </div>

            {isEmpty ? (
                /* Two CTAs on purpose: describing the house first makes the
                   seeded program fit it, but someone in a hurry can install the
                   baseline now and refine later. */
                <div className="rounded-card border border-dashed border-border bg-card px-6 py-10 text-center shadow-surface">
                    <div className="mb-3 flex justify-center text-muted-foreground">
                        <Wrench className="h-10 w-10" />
                    </div>
                    <h3 className="text-body font-semibold text-foreground">
                        {t('house.care.empty.title')}
                    </h3>
                    <p className="mx-auto mt-1 max-w-lg text-caption text-muted-foreground">
                        {t('house.care.empty.description')}
                    </p>
                    <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
                        <Button onClick={() => setProfileOpen(true)} variant="secondary">
                            <Home className="mr-2 h-4 w-4" />
                            {t('house.care.empty.configure')}
                        </Button>
                        <Button onClick={() => seed.mutateAsync({})} disabled={seed.isPending}>
                            {seed.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Sparkles className="mr-2 h-4 w-4" />
                            )}
                            {t('house.care.empty.install')}
                        </Button>
                    </div>
                </div>
            ) : (
                <>
                    {/* Stat row */}
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Card>
                            <CardContent className="p-4">
                                <p className="text-micro text-muted-foreground">
                                    {t('house.care.stats.overdue')}
                                </p>
                                <p
                                    className={`text-h1 font-semibold ${
                                        (counts?.overdue ?? 0) > 0
                                            ? 'text-danger'
                                            : 'text-foreground'
                                    }`}
                                >
                                    {counts?.overdue ?? 0}
                                </p>
                                {(counts?.overdue_critical ?? 0) > 0 && (
                                    <p className="text-micro text-danger">
                                        {t('house.care.stats.criticalCount', {
                                            count: counts?.overdue_critical ?? 0,
                                        })}
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4">
                                <p className="text-micro text-muted-foreground">
                                    {t('house.care.stats.weekly')}
                                </p>
                                <p className="text-h1 font-semibold text-foreground">
                                    {counts?.weekly_done ?? 0}
                                    <span className="text-body text-muted-foreground">
                                        /{counts?.weekly ?? 0}
                                    </span>
                                </p>
                                <p className="text-micro text-muted-foreground">
                                    {t('house.care.stats.thisWeek')}
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4">
                                <p className="text-micro text-muted-foreground">
                                    {t('house.care.stats.dueSoon')}
                                </p>
                                <p className="text-h1 font-semibold text-foreground">
                                    {counts?.due_soon ?? 0}
                                </p>
                                <p className="text-micro text-muted-foreground">
                                    {t('house.care.stats.next30')}
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4">
                                <p className="text-micro text-muted-foreground">
                                    {t('house.care.stats.budget')}
                                </p>
                                <p className="text-h1 font-semibold text-foreground">
                                    {overview?.suggested_yearly_budget != null
                                        ? `${overview.suggested_yearly_budget.toLocaleString()} $`
                                        : '—'}
                                </p>
                                <p className="text-micro text-muted-foreground">
                                    {t('house.care.stats.perYear')}
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Overdue first — this is the section that prevents repairs. */}
                    {(overview?.overdue.length ?? 0) > 0 && (
                        <section>
                            <h3 className="mb-3 flex items-center gap-2 text-body font-semibold text-danger">
                                <AlertTriangle className="h-4 w-4" />
                                {t('house.care.sections.overdue')}
                            </h3>
                            <ul className="space-y-2">
                                {overview!.overdue.map((task) => (
                                    <TaskRow
                                        key={task.id}
                                        task={task}
                                        onComplete={openComplete}
                                        onEdit={openEdit}
                                        onDelete={handleDelete}
                                    />
                                ))}
                            </ul>
                        </section>
                    )}

                    {/* Weekly tour */}
                    {(overview?.weekly_checklist.length ?? 0) > 0 && (
                        <section>
                            <div className="mb-3 flex items-center justify-between">
                                <h3 className="flex items-center gap-2 text-body font-semibold text-foreground">
                                    <Check className="h-4 w-4 text-success" />
                                    {t('house.care.sections.weekly')}
                                </h3>
                                <span className="text-micro text-muted-foreground">
                                    {t('house.care.sections.weeklyProgress', {
                                        done: counts?.weekly_done ?? 0,
                                        total: counts?.weekly ?? 0,
                                    })}
                                </span>
                            </div>
                            <p className="mb-3 text-micro text-muted-foreground">
                                {t('house.care.sections.weeklyHint')}
                            </p>
                            <ul className="space-y-2">
                                {overview!.weekly_checklist.map((task) => (
                                    <li
                                        key={task.id}
                                        className={`rounded-card border p-3 ${
                                            task.done_this_week
                                                ? 'border-success/30 bg-success-soft/20'
                                                : 'border-border bg-card'
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <button
                                                type="button"
                                                onClick={() => tickWeekly(task)}
                                                disabled={task.done_this_week}
                                                className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border transition-colors ${
                                                    task.done_this_week
                                                        ? 'border-success bg-success text-white'
                                                        : 'border-border hover:border-primary'
                                                }`}
                                                aria-label={t('house.care.markDone')}
                                            >
                                                {task.done_this_week && (
                                                    <Check className="h-3 w-3" />
                                                )}
                                            </button>
                                            <div className="min-w-0 flex-1">
                                                <p
                                                    className={`text-caption ${
                                                        task.done_this_week
                                                            ? 'text-muted-foreground line-through'
                                                            : 'font-medium text-foreground'
                                                    }`}
                                                >
                                                    {task.title}
                                                </p>
                                                {!task.done_this_week && task.risk_if_skipped && (
                                                    <p className="mt-1 text-micro text-muted-foreground">
                                                        {task.risk_if_skipped.slice(0, 160)}
                                                        {task.risk_if_skipped.length > 160
                                                            ? '…'
                                                            : ''}
                                                    </p>
                                                )}
                                            </div>
                                            {task.estimated_minutes != null && (
                                                <span className="flex-shrink-0 text-micro text-muted-foreground">
                                                    {t('house.care.minutes', {
                                                        count: task.estimated_minutes,
                                                    })}
                                                </span>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {/* This season */}
                    {(overview?.season_tasks.length ?? 0) > 0 && (
                        <section>
                            <h3 className="mb-3 flex items-center gap-2 text-body font-semibold text-foreground">
                                <CalendarClock className="h-4 w-4 text-primary" />
                                {t('house.care.sections.season', { season: overview!.season })}
                            </h3>
                            <ul className="space-y-2">
                                {overview!.season_tasks.map((task) => (
                                    <TaskRow
                                        key={task.id}
                                        task={task}
                                        onComplete={openComplete}
                                        onEdit={openEdit}
                                        onDelete={handleDelete}
                                    />
                                ))}
                            </ul>
                        </section>
                    )}

                    {/* Big-ticket horizon */}
                    {(overview?.big_ticket.length ?? 0) > 0 && (
                        <section>
                            <h3 className="mb-3 flex items-center gap-2 text-body font-semibold text-foreground">
                                <TrendingDown className="h-4 w-4 text-info" />
                                {t('house.care.sections.bigTicket')}
                            </h3>
                            <p className="mb-3 text-micro text-muted-foreground">
                                {t('house.care.sections.bigTicketHint')}
                            </p>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                {overview!.big_ticket.map((item) => (
                                    <Card key={item.key}>
                                        <CardContent className="p-4">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="text-caption font-semibold text-foreground">
                                                    {item.label}
                                                </p>
                                                <Badge
                                                    variant={
                                                        item.years_left <= 2
                                                            ? 'danger'
                                                            : item.years_left <= 5
                                                              ? 'warning'
                                                              : 'secondary'
                                                    }
                                                >
                                                    {item.years_left <= 0
                                                        ? t('house.care.bigTicket.due')
                                                        : t('house.care.bigTicket.yearsLeft', {
                                                              count: item.years_left,
                                                          })}
                                                </Badge>
                                            </div>
                                            <p className="mt-1 text-micro text-muted-foreground">
                                                {t('house.care.bigTicket.installed', {
                                                    year: item.installed_year,
                                                })}
                                            </p>
                                            <p className="mt-2 text-caption text-foreground">
                                                ≈ {item.estimated_cost.toLocaleString()} $
                                            </p>
                                            <p className="text-micro text-info">
                                                {t('house.care.bigTicket.provision', {
                                                    amount: item.yearly_provision.toLocaleString(),
                                                })}
                                            </p>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Recent issues — the thread the AI briefing picks back up. */}
                    {(overview?.recent_issues.length ?? 0) > 0 && (
                        <section className="rounded-card border border-warning/30 bg-warning-soft/30 p-4">
                            <h3 className="mb-2 flex items-center gap-2 text-body font-semibold text-warning">
                                <AlertTriangle className="h-4 w-4" />
                                {t('house.care.sections.issues')}
                            </h3>
                            <ul className="space-y-2">
                                {overview!.recent_issues.map((log) => (
                                    <li key={log.id} className="text-caption text-foreground">
                                        <span className="text-micro text-muted-foreground">
                                            {log.done_on} ·{' '}
                                        </span>
                                        <span className="font-medium">{log.task_title}</span>
                                        {log.observation && (
                                            <span className="text-muted-foreground">
                                                {' '}
                                                — {log.observation}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {/* Full program */}
                    <section>
                        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <h3 className="text-body font-semibold text-foreground">
                                {t('house.care.sections.all', { count: allTasks?.length ?? 0 })}
                            </h3>
                            <div className="flex gap-2">
                                <Select
                                    value={seasonFilter}
                                    onValueChange={(v) => setSeasonFilter(v as CareSeason | '')}
                                    options={seasonOptions}
                                    className="w-40"
                                />
                                <Select
                                    value={categoryFilter}
                                    onValueChange={(v) => setCategoryFilter(v as CareCategory | '')}
                                    options={categoryOptions}
                                    className="w-48"
                                />
                            </div>
                        </div>
                        <ul className="space-y-2">
                            {(allTasks ?? []).map((task) => (
                                <TaskRow
                                    key={task.id}
                                    task={task}
                                    onComplete={openComplete}
                                    onEdit={openEdit}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </ul>
                        {(allTasks?.length ?? 0) === 0 && (
                            <p className="py-6 text-center text-caption text-muted-foreground">
                                {t('house.care.noMatch')}
                            </p>
                        )}
                    </section>

                    {/* Top up the catalog after a profile change (added a pool,
                        a wood stove…). Idempotent, so it's safe to re-run. */}
                    <div className="flex justify-center pt-2">
                        <Button
                            variant="ghost"
                            onClick={() => seed.mutateAsync({})}
                            disabled={seed.isPending}
                        >
                            {seed.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Sparkles className="mr-2 h-4 w-4" />
                            )}
                            {t('house.care.actions.reseed')}
                        </Button>
                    </div>
                </>
            )}

            <HouseProfileDialog
                open={profileOpen}
                onOpenChange={setProfileOpen}
                onSaved={() => {
                    // A profile change alters which catalog tasks apply, so top
                    // the program up right away rather than making the user find
                    // the button.
                    void seed.mutateAsync({});
                }}
            />
            <CarePlanAiDialog open={planOpen} onOpenChange={setPlanOpen} />
            <WeeklyBriefingDialog open={briefingOpen} onOpenChange={setBriefingOpen} />
            <HouseDiagnoseDialog open={diagnoseOpen} onOpenChange={setDiagnoseOpen} />
            <CareTaskDialog
                open={taskDialogOpen}
                onOpenChange={setTaskDialogOpen}
                task={editingTask}
            />
            <CareCompleteDialog
                open={completeOpen}
                onOpenChange={setCompleteOpen}
                task={completingTask}
            />
        </div>
    );
};

export default HouseCareTab;
