import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AlertTriangle,
    CheckCircle2,
    CloudSun,
    Clock,
    Loader2,
    Sparkles,
    Info,
    Siren,
} from 'lucide-react';
import { Button, Dialog } from '../ui';
import { useGenerateWeeklyBriefing, type WeeklyBriefing } from '../../hooks/useHouseCare';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const ALERT_STYLES: Record<string, { wrapper: string; icon: React.ReactNode }> = {
    urgent: {
        wrapper: 'border-danger/30 bg-danger-soft/50 text-danger',
        icon: <Siren className="mt-0.5 h-4 w-4 flex-shrink-0" />,
    },
    attention: {
        wrapper: 'border-warning/30 bg-warning-soft/50 text-warning',
        icon: <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />,
    },
    info: {
        wrapper: 'border-info/30 bg-info-soft/40 text-info',
        icon: <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />,
    },
};

/**
 * The weekly assistant. Generated on demand rather than cached: the whole value
 * is that it reflects THIS week's forecast and THIS week's backlog, and both
 * move daily.
 */
export const WeeklyBriefingDialog: React.FC<Props> = ({ open, onOpenChange }) => {
    const { t } = useTranslation();
    const generate = useGenerateWeeklyBriefing();
    const [briefing, setBriefing] = useState<WeeklyBriefing | null>(null);
    const [weatherUsed, setWeatherUsed] = useState(false);
    const [error, setError] = useState('');

    const run = async () => {
        setError('');
        setBriefing(null);
        try {
            const result = await generate.mutateAsync({});
            setBriefing(result.briefing);
            setWeatherUsed(result.weatherUsed);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('house.care.ai.briefingFailed'));
        }
    };

    useEffect(() => {
        if (!open) return;
        void run();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const loading = generate.isPending;

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={t('house.care.ai.briefingTitle')}
            description={t('house.care.ai.briefingDescription')}
            className="sm:max-w-2xl"
        >
            <div className="space-y-5">
                {loading && (
                    <div className="flex flex-col items-center justify-center py-12">
                        <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary" />
                        <p className="text-body text-muted-foreground">
                            {t('house.care.ai.briefingGenerating')}
                        </p>
                    </div>
                )}

                {error && !loading && (
                    <div className="flex items-start gap-2 rounded-input border border-warning/30 bg-warning-soft px-4 py-3 text-caption text-warning">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {briefing && !loading && (
                    <>
                        <section className="rounded-card border border-primary/30 bg-primary/5 p-4">
                            <p className="text-body font-semibold text-foreground">
                                {briefing.headline}
                            </p>
                            {briefing.summary && (
                                <p className="mt-1.5 text-caption text-muted-foreground">
                                    {briefing.summary}
                                </p>
                            )}
                        </section>

                        {briefing.weatherAlerts.length > 0 && (
                            <section className="space-y-2">
                                <h4 className="flex items-center gap-2 text-caption font-semibold text-foreground">
                                    <CloudSun className="h-4 w-4" />
                                    {t('house.care.ai.weatherAlerts')}
                                </h4>
                                {briefing.weatherAlerts.map((a, i) => {
                                    const style = ALERT_STYLES[a.level] ?? ALERT_STYLES.info;
                                    return (
                                        <div
                                            key={i}
                                            className={`flex items-start gap-2 rounded-input border px-3 py-2.5 text-caption ${style.wrapper}`}
                                        >
                                            {style.icon}
                                            <span className="text-foreground">{a.message}</span>
                                        </div>
                                    );
                                })}
                            </section>
                        )}

                        {briefing.focus.length > 0 && (
                            <section>
                                <h4 className="mb-3 flex items-center gap-2 text-body font-semibold text-foreground">
                                    <Sparkles className="h-4 w-4 text-accent" />
                                    {t('house.care.ai.thisWeek')}
                                </h4>
                                <ol className="space-y-3">
                                    {briefing.focus.map((f, i) => (
                                        <li key={i} className="flex items-start gap-3">
                                            <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-label-sm font-semibold text-primary-foreground">
                                                {i + 1}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="text-caption font-semibold text-foreground">
                                                    {f.title}
                                                </p>
                                                <p className="text-label-sm text-muted-foreground">
                                                    {f.why}
                                                </p>
                                                <p className="mt-1 flex flex-wrap items-center gap-3 text-micro text-muted-foreground">
                                                    {f.when && (
                                                        <span className="inline-flex items-center gap-1 text-primary">
                                                            <Clock className="h-3 w-3" />
                                                            {f.when}
                                                        </span>
                                                    )}
                                                    {f.minutes != null && (
                                                        <span>
                                                            {t('house.care.minutes', {
                                                                count: f.minutes,
                                                            })}
                                                        </span>
                                                    )}
                                                </p>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            </section>
                        )}

                        {briefing.quickChecks.length > 0 && (
                            <section className="rounded-card border border-border bg-card p-4">
                                <h4 className="mb-2.5 flex items-center gap-2 text-body font-semibold text-foreground">
                                    <CheckCircle2 className="h-4 w-4 text-success" />
                                    {t('house.care.ai.quickChecks')}
                                </h4>
                                <ul className="space-y-2">
                                    {briefing.quickChecks.map((c, i) => (
                                        <li key={i} className="flex items-start gap-2">
                                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-success" />
                                            <div className="min-w-0">
                                                <p className="text-caption text-foreground">
                                                    {c.label}
                                                </p>
                                                {c.detail && (
                                                    <p className="text-micro text-muted-foreground">
                                                        {c.detail}
                                                    </p>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {briefing.encouragement && (
                            <p className="text-caption italic text-muted-foreground">
                                {briefing.encouragement}
                            </p>
                        )}

                        {!weatherUsed && (
                            <p className="text-micro text-muted-foreground">
                                {t('house.care.ai.noWeatherNotice')}
                            </p>
                        )}
                    </>
                )}

                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" onClick={run} disabled={loading}>
                        {t('house.care.ai.regenerate')}
                    </Button>
                    <Button onClick={() => onOpenChange(false)}>
                        {t('garden.common.close', { defaultValue: 'Fermer' })}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};

export default WeeklyBriefingDialog;
