import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AlertTriangle,
    HelpCircle,
    Loader2,
    Phone,
    Search,
    ShieldAlert,
    Siren,
    Stethoscope,
    Wallet,
} from 'lucide-react';
import { Badge, Button, Dialog, Input, Textarea } from '../ui';
import { useDiagnoseHouse, type HouseDiagnosis } from '../../hooks/useHouseCare';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const URGENCY_VARIANT: Record<string, 'danger' | 'warning' | 'secondary'> = {
    Immédiat: 'danger',
    'Cette semaine': 'warning',
    'À surveiller': 'secondary',
};

/**
 * Symptom → likely causes, urgency, and whether to call a pro.
 *
 * This is advice, not an inspection, and the UI says so out loud. The value for
 * a first-time owner isn't the diagnosis itself — it's knowing whether to worry
 * tonight, and what to ask the professional so they don't get sold a roof when
 * they need a $200 flashing repair.
 */
export const HouseDiagnoseDialog: React.FC<Props> = ({ open, onOpenChange }) => {
    const { t } = useTranslation();
    const diagnose = useDiagnoseHouse();

    const [symptom, setSymptom] = useState('');
    const [location, setLocation] = useState('');
    const [since, setSince] = useState('');
    const [result, setResult] = useState<HouseDiagnosis | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) return;
        setSymptom('');
        setLocation('');
        setSince('');
        setResult(null);
        setError('');
    }, [open]);

    const run = async () => {
        setError('');
        setResult(null);
        try {
            const r = await diagnose.mutateAsync({
                symptom: symptom.trim(),
                location: location.trim() || undefined,
                since: since.trim() || undefined,
            });
            setResult(r.diagnosis);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('house.care.ai.diagnoseFailed'));
        }
    };

    const loading = diagnose.isPending;
    const canSubmit = symptom.trim().length >= 10 && !loading;

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={t('house.care.ai.diagnoseTitle')}
            description={t('house.care.ai.diagnoseDescription')}
            className="sm:max-w-2xl"
        >
            <div className="space-y-5">
                <div className="space-y-3">
                    <div>
                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                            {t('house.care.ai.symptom')}
                        </label>
                        <Textarea
                            rows={3}
                            value={symptom}
                            onChange={(e) => setSymptom(e.target.value)}
                            placeholder={t('house.care.ai.symptomPlaceholder')}
                        />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="mb-1.5 block text-caption font-medium text-foreground">
                                {t('house.care.ai.where')}
                            </label>
                            <Input
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                placeholder={t('house.care.ai.wherePlaceholder')}
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-caption font-medium text-foreground">
                                {t('house.care.ai.since')}
                            </label>
                            <Input
                                value={since}
                                onChange={(e) => setSince(e.target.value)}
                                placeholder={t('house.care.ai.sincePlaceholder')}
                            />
                        </div>
                    </div>
                    <Button onClick={run} disabled={!canSubmit} className="w-full sm:w-auto">
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                {t('house.care.ai.analyzing')}
                            </>
                        ) : (
                            <>
                                <Stethoscope className="mr-2 h-4 w-4" />
                                {t('house.care.ai.analyze')}
                            </>
                        )}
                    </Button>
                </div>

                {error && !loading && (
                    <div className="flex items-start gap-2 rounded-input border border-warning/30 bg-warning-soft px-4 py-3 text-caption text-warning">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {result && !loading && (
                    <>
                        <section className="rounded-card border border-border bg-card p-4">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                                <Badge variant={URGENCY_VARIANT[result.urgency] ?? 'secondary'}>
                                    {result.urgency}
                                </Badge>
                                {result.callAPro && result.proType && (
                                    <Badge variant="primary">
                                        <Phone className="mr-1 inline h-3 w-3" />
                                        {result.proType}
                                    </Badge>
                                )}
                            </div>
                            <p className="text-caption text-foreground">{result.summary}</p>
                            {result.urgencyReason && (
                                <p className="mt-1.5 text-micro text-muted-foreground">
                                    {result.urgencyReason}
                                </p>
                            )}
                        </section>

                        {result.immediateActions.length > 0 && (
                            <section className="rounded-card border border-primary/30 bg-primary/5 p-4">
                                <h4 className="mb-2 flex items-center gap-2 text-body font-semibold text-foreground">
                                    <ShieldAlert className="h-4 w-4 text-primary" />
                                    {t('house.care.ai.immediateActions')}
                                </h4>
                                <ol className="space-y-2">
                                    {result.immediateActions.map((a, i) => (
                                        <li key={i} className="flex items-start gap-2.5">
                                            <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary text-micro font-semibold text-primary-foreground">
                                                {i + 1}
                                            </span>
                                            <span className="text-caption text-foreground">
                                                {a}
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                            </section>
                        )}

                        {result.likelyCauses.length > 0 && (
                            <section>
                                <h4 className="mb-3 flex items-center gap-2 text-body font-semibold text-foreground">
                                    <Search className="h-4 w-4" />
                                    {t('house.care.ai.likelyCauses')}
                                </h4>
                                <ul className="space-y-2.5">
                                    {result.likelyCauses.map((c, i) => (
                                        <li
                                            key={i}
                                            className="rounded-card border border-border bg-card p-3"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="text-caption font-semibold text-foreground">
                                                    {c.cause}
                                                </p>
                                                <Badge
                                                    variant={
                                                        c.likelihood === 'Probable'
                                                            ? 'warning'
                                                            : 'secondary'
                                                    }
                                                >
                                                    {c.likelihood}
                                                </Badge>
                                            </div>
                                            <p className="mt-1 text-label-sm text-muted-foreground">
                                                {c.explanation}
                                            </p>
                                            {c.howToConfirm && (
                                                <p className="mt-1.5 flex items-start gap-1.5 text-micro text-info">
                                                    <HelpCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                                                    {c.howToConfirm}
                                                </p>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {result.redFlags.length > 0 && (
                            <section className="rounded-card border border-danger/30 bg-danger-soft/40 p-4">
                                <h4 className="mb-2 flex items-center gap-2 text-body font-semibold text-danger">
                                    <Siren className="h-4 w-4" />
                                    {t('house.care.ai.redFlags')}
                                </h4>
                                <ul className="space-y-1.5">
                                    {result.redFlags.map((f, i) => (
                                        <li
                                            key={i}
                                            className="flex items-start gap-2 text-caption text-foreground"
                                        >
                                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-danger" />
                                            {f}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {result.questionsForPro.length > 0 && (
                            <section className="rounded-card border border-border bg-surface-2/40 p-4">
                                <h4 className="mb-2 flex items-center gap-2 text-body font-semibold text-foreground">
                                    <Phone className="h-4 w-4" />
                                    {t('house.care.ai.questionsForPro')}
                                </h4>
                                <ul className="space-y-1.5">
                                    {result.questionsForPro.map((q, i) => (
                                        <li key={i} className="text-caption text-foreground">
                                            · {q}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {result.estimatedCostRange && (
                            <p className="flex items-center gap-2 text-caption text-muted-foreground">
                                <Wallet className="h-4 w-4" />
                                {result.estimatedCostRange}
                            </p>
                        )}

                        <p className="rounded-input border border-border bg-surface-2/40 px-3 py-2 text-micro text-muted-foreground">
                            {t('house.care.ai.disclaimer')}
                        </p>
                    </>
                )}

                <div className="flex justify-end pt-1">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        {t('garden.common.close', { defaultValue: 'Fermer' })}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};

export default HouseDiagnoseDialog;
