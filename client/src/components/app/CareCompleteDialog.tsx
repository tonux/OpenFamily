import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, AlertTriangle, SkipForward } from 'lucide-react';
import { Button, Dialog, Input, Textarea } from '../ui';
import { useCompleteCareTask, type CareLogStatus, type CareTask } from '../../hooks/useHouseCare';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    task: CareTask | null;
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Logging a completion. The status matters more than it looks:
 *   - 'Fait' advances the schedule to the next occurrence.
 *   - 'Ignoré' records the decision but leaves the task due, so it keeps
 *     showing up instead of silently disappearing for a year.
 *   - 'Problème' is what feeds the AI briefing next week ("où en est la trace
 *     d'eau que tu as notée ?").
 */
export const CareCompleteDialog: React.FC<Props> = ({ open, onOpenChange, task }) => {
    const { t } = useTranslation();
    const complete = useCompleteCareTask();
    const [status, setStatus] = useState<CareLogStatus>('Fait');
    const [doneOn, setDoneOn] = useState(todayIso());
    const [observation, setObservation] = useState('');
    const [minutes, setMinutes] = useState('');
    const [cost, setCost] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open) return;
        setStatus('Fait');
        setDoneOn(todayIso());
        setObservation('');
        setMinutes(task?.estimated_minutes ? String(task.estimated_minutes) : '');
        setCost('');
        setError('');
    }, [open, task]);

    if (!task) return null;

    const submit = async () => {
        setError('');
        try {
            await complete.mutateAsync({
                id: task.id,
                body: {
                    done_on: doneOn,
                    status,
                    observation: observation.trim() || null,
                    minutes_spent: minutes ? Number(minutes) : null,
                    cost: cost ? Number(cost) : null,
                },
            });
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('house.common.genericError'));
        }
    };

    const statusOptions: Array<{
        value: CareLogStatus;
        label: string;
        icon: React.ReactNode;
        hint: string;
    }> = [
        {
            value: 'Fait',
            label: t('house.care.complete.statusDone'),
            icon: <Check className="h-4 w-4" />,
            hint: t('house.care.complete.statusDoneHint'),
        },
        {
            value: 'Problème',
            label: t('house.care.complete.statusIssue'),
            icon: <AlertTriangle className="h-4 w-4" />,
            hint: t('house.care.complete.statusIssueHint'),
        },
        {
            value: 'Ignoré',
            label: t('house.care.complete.statusSkipped'),
            icon: <SkipForward className="h-4 w-4" />,
            hint: t('house.care.complete.statusSkippedHint'),
        },
    ];

    const activeHint = statusOptions.find((o) => o.value === status)?.hint ?? '';

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={t('house.care.complete.title')}
            description={task.title}
        >
            <div className="space-y-5">
                <div>
                    <label className="mb-1.5 block text-caption font-medium text-foreground">
                        {t('house.care.complete.status')}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                        {statusOptions.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setStatus(opt.value)}
                                className={`flex flex-col items-center gap-1.5 rounded-input border px-2 py-3 text-label-sm transition-colors ${
                                    status === opt.value
                                        ? 'border-primary bg-primary/10 text-foreground'
                                        : 'border-border text-muted-foreground hover:border-primary/40'
                                }`}
                            >
                                {opt.icon}
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    <p className="mt-2 text-micro text-muted-foreground">{activeHint}</p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                            {t('house.care.complete.date')}
                        </label>
                        <Input
                            type="date"
                            value={doneOn}
                            onChange={(e) => setDoneOn(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                            {t('house.care.complete.minutes')}
                        </label>
                        <Input
                            type="number"
                            min={0}
                            value={minutes}
                            onChange={(e) => setMinutes(e.target.value)}
                            placeholder="30"
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                            {t('house.care.complete.cost')}
                        </label>
                        <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={cost}
                            onChange={(e) => setCost(e.target.value)}
                            placeholder="0"
                        />
                    </div>
                </div>

                <div>
                    <label className="mb-1.5 block text-caption font-medium text-foreground">
                        {t('house.care.complete.observation')}
                    </label>
                    <Textarea
                        rows={3}
                        value={observation}
                        onChange={(e) => setObservation(e.target.value)}
                        placeholder={t('house.care.complete.observationPlaceholder')}
                    />
                    <p className="mt-1 text-micro text-muted-foreground">
                        {t('house.care.complete.observationHint')}
                    </p>
                </div>

                {error && (
                    <p className="rounded-input border border-danger/30 bg-danger-soft px-3 py-2 text-caption text-danger">
                        {error}
                    </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        {t('house.common.cancel', { defaultValue: 'Annuler' })}
                    </Button>
                    <Button onClick={submit} disabled={complete.isPending}>
                        {complete.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Check className="mr-2 h-4 w-4" />
                        )}
                        {t('house.care.complete.submit')}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};

export default CareCompleteDialog;
