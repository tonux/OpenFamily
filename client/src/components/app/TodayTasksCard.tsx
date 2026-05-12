import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, Square, AlertCircle, ChevronRight, Repeat, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, Button, useToast } from '../ui';
import { useTodayTasks, useUpdateTask, type Task } from '../../hooks/useTasks';

// =============================================================================
// TodayTasksCard
//
// Compact dashboard widget: tasks due today + tasks overdue + count of
// upcoming. Each row has a checkbox to mark done in one click, which on the
// server triggers auto-creation of the next occurrence for recurring tasks.
// We surface that creation with a brief toast so the user knows their next
// "sortir les poubelles" is already on the calendar.
// =============================================================================

const recurrenceLabel = (frequency: string | null): string | null => {
    if (!frequency || frequency === 'Une fois') return null;
    return frequency;
};

const TodayTasksCard: React.FC = () => {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const query = useTodayTasks();
    const updateMut = useUpdateTask();
    const [completingId, setCompletingId] = useState<string | null>(null);

    const handleComplete = async (task: Task) => {
        setCompletingId(task.id);
        try {
            const result = await updateMut.mutateAsync({
                id: task.id,
                patch: { is_completed: true },
            });
            if (result.next_occurrence) {
                const nextDate = result.next_occurrence.due_date;
                showToast({
                    title: 'Tâche terminée ✓',
                    description: nextDate
                        ? `Prochaine occurrence créée pour le ${formatShortDate(nextDate)}`
                        : 'Prochaine occurrence créée',
                });
            }
        } catch (err) {
            showToast({
                title: 'Impossible de marquer la tâche',
                description: err instanceof Error ? err.message : 'Erreur',
            });
        } finally {
            setCompletingId(null);
        }
    };

    if (query.isPending) {
        return (
            <Card className="shadow-nexus border-none">
                <CardContent className="p-6 animate-pulse space-y-3">
                    <div className="h-5 w-40 rounded bg-surface-2" />
                    <div className="h-16 rounded bg-surface-2" />
                </CardContent>
            </Card>
        );
    }
    if (query.isError) return null;

    const data = query.data!;
    const hasAny = data.today.length > 0 || data.overdue.length > 0;

    return (
        <Card className="shadow-nexus border-none">
            <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-h2 font-semibold flex items-center gap-2">
                            <CheckSquare className="h-5 w-5 text-primary" />
                            Tâches du jour
                        </h2>
                        <p className="text-micro text-muted-foreground">
                            {data.today.length} aujourd'hui
                            {data.overdue.length > 0 && (
                                <span className="text-destructive">
                                    {' '}
                                    · {data.overdue.length} en retard
                                </span>
                            )}
                            {data.upcoming_count > 0 && (
                                <span> · {data.upcoming_count} dans les 7j</span>
                            )}
                        </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => navigate('/tasks')}>
                        Voir tout
                        <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                </div>

                {!hasAny ? (
                    <div className="flex items-center gap-2 rounded-card border border-emerald-200 bg-emerald-50 px-3 py-2 text-caption text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                        Rien à faire pour aujourd'hui — bien joué !
                    </div>
                ) : (
                    <div className="space-y-3">
                        {data.overdue.length > 0 && (
                            <Section
                                label={`En retard (${data.overdue.length})`}
                                tone="destructive"
                                tasks={data.overdue}
                                completingId={completingId}
                                onComplete={handleComplete}
                            />
                        )}
                        {data.today.length > 0 && (
                            <Section
                                label="Aujourd'hui"
                                tone="primary"
                                tasks={data.today}
                                completingId={completingId}
                                onComplete={handleComplete}
                            />
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

const Section: React.FC<{
    label: string;
    tone: 'primary' | 'destructive';
    tasks: Task[];
    completingId: string | null;
    onComplete: (t: Task) => void;
}> = ({ label, tone, tasks, completingId, onComplete }) => (
    <div className="space-y-1.5">
        <p
            className={`text-caption font-semibold ${
                tone === 'destructive' ? 'text-destructive' : 'text-primary'
            }`}
        >
            {label}
        </p>
        <ul className="space-y-1.5">
            {tasks.map((t) => (
                <TaskRow
                    key={t.id}
                    task={t}
                    isCompleting={completingId === t.id}
                    onComplete={() => onComplete(t)}
                    overdue={tone === 'destructive'}
                />
            ))}
        </ul>
    </div>
);

const TaskRow: React.FC<{
    task: Task;
    isCompleting: boolean;
    overdue: boolean;
    onComplete: () => void;
}> = ({ task, isCompleting, overdue, onComplete }) => {
    const recur = recurrenceLabel(task.frequency);
    return (
        <li className="flex items-center gap-3 rounded-input border border-border bg-card px-3 py-2">
            <button
                type="button"
                onClick={onComplete}
                disabled={isCompleting}
                className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                    isCompleting
                        ? 'border-primary bg-primary/20'
                        : 'border-input hover:border-primary'
                }`}
                aria-label="Marquer comme fait"
            >
                {isCompleting ? (
                    <CheckSquare className="h-3.5 w-3.5 text-primary animate-pulse" />
                ) : (
                    <Square className="h-3.5 w-3.5 text-muted-foreground" />
                )}
            </button>
            <div className="min-w-0 flex-1">
                <p className="text-caption font-medium truncate">{task.title}</p>
                <p className="text-micro text-muted-foreground flex items-center gap-2 flex-wrap">
                    {overdue && task.due_date && (
                        <span className="text-destructive flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            {formatShortDate(task.due_date)}
                        </span>
                    )}
                    {recur && (
                        <span className="inline-flex items-center gap-0.5 text-primary">
                            <Repeat className="h-3 w-3" />
                            {recur}
                        </span>
                    )}
                    {task.assigned_to_members && task.assigned_to_members.length > 0 && (
                        <span className="flex items-center gap-1">
                            {task.assigned_to_members.slice(0, 3).map((m) => (
                                <span
                                    key={m.id}
                                    className="inline-flex items-center gap-0.5"
                                    title={m.name}
                                >
                                    <span
                                        className="h-2 w-2 rounded-full"
                                        style={{ background: m.color }}
                                    />
                                    {m.name}
                                </span>
                            ))}
                        </span>
                    )}
                </p>
            </div>
        </li>
    );
};

const formatShortDate = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
};

export default TodayTasksCard;
