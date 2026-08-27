import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Save } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea } from '../ui';
import {
    CARE_CATEGORIES,
    CARE_FREQUENCIES,
    CARE_PRIORITIES,
    CARE_RESPONSIBILITIES,
    CARE_SEASONS,
    useCreateCareTask,
    useUpdateCareTask,
    type CareCategory,
    type CareFrequency,
    type CarePriority,
    type CareResponsibility,
    type CareSeason,
    type CareTask,
} from '../../hooks/useHouseCare';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    task: CareTask | null;
}

/** Default recurrence in months per frequency, so the user rarely types it. */
const DEFAULT_INTERVAL: Record<CareFrequency, number | null> = {
    Hebdomadaire: null,
    Mensuel: 1,
    Trimestriel: 3,
    Saisonnier: 12,
    Annuel: 12,
    Pluriannuel: 24,
};

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const CareTaskDialog: React.FC<Props> = ({ open, onOpenChange, task }) => {
    const { t } = useTranslation();
    const create = useCreateCareTask();
    const update = useUpdateCareTask();

    const [title, setTitle] = useState('');
    const [category, setCategory] = useState<CareCategory>('Intérieur');
    const [season, setSeason] = useState<CareSeason>("Toute l'année");
    const [frequency, setFrequency] = useState<CareFrequency>('Annuel');
    const [intervalMonths, setIntervalMonths] = useState('12');
    const [monthStart, setMonthStart] = useState('');
    const [monthEnd, setMonthEnd] = useState('');
    const [priority, setPriority] = useState<CarePriority>('Important');
    const [responsibility, setResponsibility] = useState<CareResponsibility>('Soi-même');
    const [minutes, setMinutes] = useState('');
    const [cost, setCost] = useState('');
    const [risk, setRisk] = useState('');
    const [steps, setSteps] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open) return;
        setError('');
        if (task) {
            setTitle(task.title);
            setCategory(task.category);
            setSeason(task.season);
            setFrequency(task.frequency);
            setIntervalMonths(task.interval_months != null ? String(task.interval_months) : '');
            setMonthStart(task.month_start != null ? String(task.month_start) : '');
            setMonthEnd(task.month_end != null ? String(task.month_end) : '');
            setPriority(task.priority);
            setResponsibility(task.responsibility);
            setMinutes(task.estimated_minutes != null ? String(task.estimated_minutes) : '');
            setCost(task.estimated_cost != null ? String(task.estimated_cost) : '');
            setRisk(task.risk_if_skipped ?? '');
            setSteps(task.steps.join('\n'));
        } else {
            setTitle('');
            setCategory('Intérieur');
            setSeason("Toute l'année");
            setFrequency('Annuel');
            setIntervalMonths('12');
            setMonthStart('');
            setMonthEnd('');
            setPriority('Important');
            setResponsibility('Soi-même');
            setMinutes('');
            setCost('');
            setRisk('');
            setSteps('');
        }
    }, [open, task]);

    const onFrequencyChange = (value: CareFrequency) => {
        setFrequency(value);
        const preset = DEFAULT_INTERVAL[value];
        setIntervalMonths(preset != null ? String(preset) : '');
    };

    const submit = async () => {
        setError('');
        if (!title.trim()) {
            setError(t('house.care.task.titleRequired'));
            return;
        }
        // The window is all-or-nothing: a half-set window silently behaves as
        // "no window", which is not what someone picking a start month meant.
        if ((monthStart === '') !== (monthEnd === '')) {
            setError(t('house.care.task.windowIncomplete'));
            return;
        }

        const payload = {
            title: title.trim(),
            category,
            season,
            frequency,
            interval_months:
                frequency === 'Hebdomadaire' || intervalMonths === ''
                    ? null
                    : Number(intervalMonths),
            month_start: monthStart === '' ? null : Number(monthStart),
            month_end: monthEnd === '' ? null : Number(monthEnd),
            priority,
            responsibility,
            estimated_minutes: minutes === '' ? null : Number(minutes),
            estimated_cost: cost === '' ? null : Number(cost),
            risk_if_skipped: risk.trim() || null,
            steps: steps
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
                .slice(0, 12),
        };

        try {
            if (task) await update.mutateAsync({ id: task.id, patch: payload });
            else await create.mutateAsync(payload);
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('house.common.saveError'));
        }
    };

    const monthOptions = [
        { value: '', label: t('house.care.task.noWindow') },
        ...MONTHS.map((m) => ({
            value: String(m),
            label: t(`house.care.months.${m}`, { defaultValue: String(m) }),
        })),
    ];

    const pending = create.isPending || update.isPending;

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={task ? t('house.care.task.editTitle') : t('house.care.task.createTitle')}
            description={t('house.care.task.description')}
            className="sm:max-w-2xl"
        >
            <div className="space-y-4">
                <div>
                    <label className="mb-1.5 block text-caption font-medium">
                        {t('house.care.task.name')}
                    </label>
                    <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t('house.care.task.namePlaceholder')}
                    />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                        <label className="mb-1.5 block text-caption font-medium">
                            {t('house.care.task.category')}
                        </label>
                        <Select
                            value={category}
                            onValueChange={(v) => setCategory(v as CareCategory)}
                            options={CARE_CATEGORIES.map((c) => ({ value: c, label: c }))}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium">
                            {t('house.care.task.season')}
                        </label>
                        <Select
                            value={season}
                            onValueChange={(v) => setSeason(v as CareSeason)}
                            options={CARE_SEASONS.map((s) => ({ value: s, label: s }))}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium">
                            {t('house.care.task.frequency')}
                        </label>
                        <Select
                            value={frequency}
                            onValueChange={(v) => onFrequencyChange(v as CareFrequency)}
                            options={CARE_FREQUENCIES.map((f) => ({ value: f, label: f }))}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium">
                            {t('house.care.task.intervalMonths')}
                        </label>
                        <Input
                            type="number"
                            min={1}
                            value={intervalMonths}
                            onChange={(e) => setIntervalMonths(e.target.value)}
                            disabled={frequency === 'Hebdomadaire'}
                            placeholder="12"
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium">
                            {t('house.care.task.monthStart')}
                        </label>
                        <Select
                            value={monthStart}
                            onValueChange={setMonthStart}
                            options={monthOptions}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium">
                            {t('house.care.task.monthEnd')}
                        </label>
                        <Select
                            value={monthEnd}
                            onValueChange={setMonthEnd}
                            options={monthOptions}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium">
                            {t('house.care.task.priority')}
                        </label>
                        <Select
                            value={priority}
                            onValueChange={(v) => setPriority(v as CarePriority)}
                            options={CARE_PRIORITIES.map((p) => ({ value: p, label: p }))}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium">
                            {t('house.care.task.responsibility')}
                        </label>
                        <Select
                            value={responsibility}
                            onValueChange={(v) => setResponsibility(v as CareResponsibility)}
                            options={CARE_RESPONSIBILITIES.map((r) => ({ value: r, label: r }))}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium">
                            {t('house.care.task.minutes')}
                        </label>
                        <Input
                            type="number"
                            min={0}
                            value={minutes}
                            onChange={(e) => setMinutes(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium">
                            {t('house.care.task.cost')}
                        </label>
                        <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={cost}
                            onChange={(e) => setCost(e.target.value)}
                        />
                    </div>
                </div>

                <div>
                    <label className="mb-1.5 block text-caption font-medium">
                        {t('house.care.task.risk')}
                    </label>
                    <Textarea
                        rows={2}
                        value={risk}
                        onChange={(e) => setRisk(e.target.value)}
                        placeholder={t('house.care.task.riskPlaceholder')}
                    />
                </div>

                <div>
                    <label className="mb-1.5 block text-caption font-medium">
                        {t('house.care.task.steps')}
                    </label>
                    <Textarea
                        rows={4}
                        value={steps}
                        onChange={(e) => setSteps(e.target.value)}
                        placeholder={t('house.care.task.stepsPlaceholder')}
                    />
                </div>

                {error && (
                    <p className="rounded-input border border-danger/30 bg-danger-soft px-3 py-2 text-caption text-danger">
                        {error}
                    </p>
                )}

                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        {t('house.common.cancel', { defaultValue: 'Annuler' })}
                    </Button>
                    <Button onClick={submit} disabled={pending}>
                        {pending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : task ? (
                            <Save className="mr-2 h-4 w-4" />
                        ) : (
                            <Plus className="mr-2 h-4 w-4" />
                        )}
                        {task ? t('house.common.edit') : t('house.common.create')}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};

export default CareTaskDialog;
