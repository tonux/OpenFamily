import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Plus, Trash2, AlertCircle } from 'lucide-react';
import { Card, CardContent, Button, Input } from '../ui';
import {
    useSchoolBreaks,
    useCreateSchoolBreak,
    useDeleteSchoolBreak,
    type SchoolBreak,
} from '../../hooks/useSchoolBreaks';
import { useDateLocale } from '../../lib/dateLocale';
import { format } from 'date-fns';

// =============================================================================
// SchoolBreaksCard (Settings)
//
// Declare the periods the kids are home. This is deliberately optional: the
// server falls back to weekends + July/August, so a user who never opens this
// card still gets holiday behaviour on the dashboard all summer. Declaring rows
// buys the rest of the year, and a summer with real dates.
//
// The card says so out loud — an empty state that reads like something is
// broken would push people to fill in data they don't need.
// =============================================================================

const todayKey = (): string => format(new Date(), 'yyyy-MM-dd');

const SchoolBreaksCard: React.FC = () => {
    const { t } = useTranslation();
    const locale = useDateLocale();

    const { data: breaks, isPending } = useSchoolBreaks();
    const createBreak = useCreateSchoolBreak();
    const deleteBreak = useDeleteSchoolBreak();

    const [label, setLabel] = useState('');
    const [startDate, setStartDate] = useState(todayKey);
    const [endDate, setEndDate] = useState(todayKey);
    const [error, setError] = useState<string | null>(null);

    const rangeIsInverted = !!startDate && !!endDate && startDate > endDate;
    const canSubmit =
        label.trim().length > 0 &&
        !!startDate &&
        !!endDate &&
        !rangeIsInverted &&
        !createBreak.isPending;

    const handleAdd = async () => {
        setError(null);
        try {
            await createBreak.mutateAsync({
                label: label.trim(),
                start_date: startDate,
                end_date: endDate,
            });
            setLabel('');
        } catch (err) {
            setError(err instanceof Error ? err.message : t('settings.schoolBreaks.errorGeneric'));
        }
    };

    const formatRange = (b: SchoolBreak): string => {
        const from = format(new Date(`${b.start_date}T00:00:00`), 'd MMM yyyy', { locale });
        const to = format(new Date(`${b.end_date}T00:00:00`), 'd MMM yyyy', { locale });
        return `${from} → ${to}`;
    };

    return (
        <Card>
            <CardContent className="p-6">
                <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-primary-soft text-primary">
                        <CalendarDays className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-caption font-semibold text-foreground">
                            {t('settings.schoolBreaks.title')}
                        </h3>
                        <p className="mt-1 text-micro text-muted-foreground">
                            {t('settings.schoolBreaks.description')}
                        </p>

                        {/* Existing periods */}
                        <div className="mt-4 space-y-2">
                            {isPending ? (
                                <div className="h-10 animate-pulse rounded-card bg-surface-2" />
                            ) : !breaks || breaks.length === 0 ? (
                                <p className="rounded-card border border-dashed border-border bg-muted/20 p-3 text-micro text-muted-foreground">
                                    {t('settings.schoolBreaks.emptyHint')}
                                </p>
                            ) : (
                                breaks.map((b) => (
                                    <div
                                        key={b.id}
                                        className="flex items-center gap-3 rounded-card border border-border bg-card p-3"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-caption font-medium">
                                                {b.label}
                                            </p>
                                            <p className="text-micro text-muted-foreground">
                                                {formatRange(b)}
                                            </p>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            aria-label={t('settings.schoolBreaks.delete')}
                                            onClick={() => deleteBreak.mutate(b.id)}
                                            disabled={deleteBreak.isPending}
                                        >
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Add a period */}
                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
                            <Input
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                placeholder={t('settings.schoolBreaks.labelPlaceholder')}
                                maxLength={100}
                            />
                            <Input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                aria-label={t('settings.schoolBreaks.startDate')}
                            />
                            <Input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                aria-label={t('settings.schoolBreaks.endDate')}
                            />
                        </div>

                        {(rangeIsInverted || error) && (
                            <p className="mt-2 flex items-center gap-1 text-micro text-destructive">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                {rangeIsInverted
                                    ? t('settings.schoolBreaks.errorInvertedRange')
                                    : error}
                            </p>
                        )}

                        <Button className="mt-4" onClick={handleAdd} disabled={!canSubmit}>
                            <Plus className="mr-1.5 h-4 w-4" />
                            {createBreak.isPending
                                ? t('settings.schoolBreaks.adding')
                                : t('settings.schoolBreaks.add')}
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default SchoolBreaksCard;
