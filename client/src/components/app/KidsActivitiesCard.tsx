import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    AlertCircle,
    CalendarPlus,
    Check,
    Clock,
    MapPin,
    Package,
    RefreshCw,
    Shuffle,
    Sunrise,
    Sun,
    Sunset,
    Trees,
    Palette,
    ChefHat,
    Lightbulb,
    Bike,
    Hand,
    Users,
    MonitorOff,
} from 'lucide-react';
import { Card, CardContent, Button, useToast } from '../ui';
import { useAuth } from '../../contexts/AuthContext';
import {
    useKidsActivities,
    type ActivitiesDegradedCode,
    type ActivityCategory,
    type ActivityTimeOfDay,
    type KidActivityDTO,
} from '../../hooks/useKidsActivities';
import type { ClothingKidDTO } from '../../hooks/useDashboardWeather';
import { useScheduleActivity, ActivityConflictError } from '../../hooks/useScheduleActivity';
import { dayContextHeading, isTodayContext } from '../../lib/dayContextLabel';

// =============================================================================
// KidsActivitiesCard
//
// Screen-free things to do on a day the kids are home. Mounted by the dashboard
// only when the server says the target day is a home day (holidays, weekend) —
// see `dayContext.mode` and lib/dayContext.ts on the server.
//
// Design constraint worth keeping: this card must never render empty. An empty
// "what shall we do today?" card concedes the day to the tablet, which is the
// one thing the feature exists to prevent — so when the AI is off or over quota
// the server serves a static bank instead of nothing, and we only downgrade the
// wording (`aiUnavailable`), never the content.
// =============================================================================

const CATEGORY_ICON: Record<ActivityCategory, React.ComponentType<{ className?: string }>> = {
    outdoor: Trees,
    creative: Palette,
    cooking: ChefHat,
    learning: Lightbulb,
    sport: Bike,
    chores: Hand,
    social: Users,
};

const TIME_ICON: Record<ActivityTimeOfDay, React.ComponentType<{ className?: string }>> = {
    morning: Sunrise,
    afternoon: Sun,
    evening: Sunset,
};

// Any AI failure degrades to the offline bank, so an unknown code is expected
// (a provider outage, a timeout…) — it gets the generic wording rather than a
// missing translation key.
const DEGRADED_LABEL_KEY: Record<string, string> = {
    DISABLED: 'kidsActivities.degradedDisabled',
    QUOTA_EXCEEDED: 'kidsActivities.degradedQuotaExceeded',
    BAD_JSON: 'kidsActivities.degradedBadJson',
};

const degradedLabelKeyFor = (code: ActivitiesDegradedCode): string =>
    DEGRADED_LABEL_KEY[code] ?? 'kidsActivities.degradedGeneric';

interface Props {
    /** Session-only geolocation override, shared with the weather card. */
    override?: { latitude: number; longitude: number } | null;
}

const KidsActivitiesCard: React.FC<Props> = ({ override = null }) => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const navigate = useNavigate();

    // Titles already shown. Sending them back lets the model propose something
    // else instead of rotating the same four ideas all summer.
    const [exclude, setExclude] = useState<string[]>([]);

    const enabled =
        !!user && (override !== null || (user.latitude !== null && user.latitude !== undefined));

    const query = useKidsActivities(override, exclude, { enabled });

    // No saved city: stay silent rather than showing a second "configure your
    // city" CTA under the weather card's. It also keeps us honest — without the
    // request we don't know whether the day is even a home day, and prompting
    // on a school evening would be noise.
    if (!enabled) return null;

    if (query.isPending) {
        return (
            <Card className="shadow-nexus border-none">
                <CardContent className="p-6">
                    <div className="animate-pulse space-y-4">
                        <div className="h-6 w-56 rounded bg-surface-2" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="h-28 rounded-card bg-surface-2" />
                            <div className="h-28 rounded-card bg-surface-2" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (query.isError) {
        return (
            <Card className="shadow-nexus border-none">
                <CardContent className="p-6 flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 text-destructive shrink-0" />
                    <p className="flex-1 text-caption font-semibold">
                        {t('kidsActivities.errorTitle')}
                    </p>
                    <Button variant="ghost" size="sm" onClick={() => query.refetch()}>
                        <RefreshCw className="h-4 w-4 mr-1.5" />
                        {t('kidsActivities.retry')}
                    </Button>
                </CardContent>
            </Card>
        );
    }

    const data = query.data!;

    // The dashboard already gates on this, but the card owns its own contract:
    // it has nothing to say about a school day.
    if (data.dayContext.mode !== 'home') return null;

    if (data.kids.length === 0) {
        return (
            <EmptyShell
                title={t('kidsActivities.addKidTitle')}
                description={t('kidsActivities.addKidDescription')}
                actionLabel={t('kidsActivities.goToFamily')}
                onAction={() => navigate('/family')}
            />
        );
    }

    const today = isTodayContext(data.dayContext);
    const regenerate = () => {
        setExclude((prev) =>
            // Cap the list: the server caps it at 20 too, and a prompt stuffed
            // with exclusions crowds out the actual instructions.
            [...prev, ...data.activities.map((a) => a.title)].slice(-12),
        );
    };

    return (
        <Card className="shadow-nexus border-none">
            <CardContent className="p-6 space-y-4">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                    <div>
                        <h2 className="text-h2 font-semibold flex items-center gap-2">
                            <MonitorOff className="h-5 w-5 text-primary" />
                            {today
                                ? t('kidsActivities.titleToday')
                                : t('kidsActivities.titleTomorrow')}
                        </h2>
                        <p className="text-micro text-muted-foreground flex flex-wrap items-center gap-1">
                            <span>{dayContextHeading(data.dayContext, t)}</span>
                            <span>·</span>
                            <span>
                                {t('kidsActivities.subtitle', { count: data.activities.length })}
                            </span>
                            {data.aiUnavailable && data.code && (
                                <span className="ml-1 italic">
                                    · {t(degradedLabelKeyFor(data.code))}
                                </span>
                            )}
                        </p>
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={regenerate}
                        disabled={query.isFetching}
                    >
                        <Shuffle className="h-4 w-4 mr-1.5" />
                        {query.isFetching
                            ? t('kidsActivities.regenerating')
                            : t('kidsActivities.regenerate')}
                    </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {data.activities.map((activity) => (
                        <ActivityTile
                            key={activity.title}
                            activity={activity}
                            kids={data.kids}
                            dateKey={data.dayContext.date}
                        />
                    ))}
                </div>
            </CardContent>
        </Card>
    );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const EmptyShell: React.FC<{
    title: string;
    description: string;
    actionLabel: string;
    onAction: () => void;
}> = ({ title, description, actionLabel, onAction }) => (
    <Card className="shadow-nexus border-none">
        <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card bg-primary-soft">
                <MapPin className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
                <h3 className="text-caption font-semibold text-foreground">{title}</h3>
                <p className="mt-1 text-micro text-muted-foreground">{description}</p>
            </div>
            <Button onClick={onAction}>{actionLabel}</Button>
        </CardContent>
    </Card>
);

const ActivityTile: React.FC<{
    activity: KidActivityDTO;
    kids: ClothingKidDTO[];
    dateKey: string;
}> = ({ activity, kids, dateKey }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const scheduleActivity = useScheduleActivity();
    const [scheduled, setScheduled] = useState(false);

    const CategoryIcon = CATEGORY_ICON[activity.category];
    const TimeIcon = TIME_ICON[activity.timeOfDay];

    const concerned = useMemo(
        () => kids.filter((k) => activity.kidIds.includes(k.id)),
        [kids, activity.kidIds],
    );

    const handleSchedule = async () => {
        try {
            await scheduleActivity.mutateAsync({ activity, dateKey });
            setScheduled(true);
            showToast({
                title: t('kidsActivities.scheduledTitle'),
                description: t('kidsActivities.scheduledDescription', { title: activity.title }),
            });
        } catch (err) {
            // The planning route guards overlaps, so this is the common failure:
            // the slot is already taken. Say which, rather than "an error occurred".
            showToast({
                title:
                    err instanceof ActivityConflictError
                        ? t('kidsActivities.conflictTitle')
                        : t('kidsActivities.scheduleFailedTitle'),
                description:
                    err instanceof ActivityConflictError
                        ? t('kidsActivities.conflictDescription')
                        : undefined,
            });
        }
    };

    return (
        <div className="rounded-card border border-border bg-card p-3 space-y-2">
            <div className="flex items-start gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card bg-primary-soft">
                    <CategoryIcon className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-caption font-semibold leading-snug">{activity.title}</p>
                    <p className="text-micro text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="inline-flex items-center gap-1">
                            <TimeIcon className="h-3.5 w-3.5" />
                            {t(`kidsActivities.timesOfDay.${activity.timeOfDay}`)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {t('kidsActivities.durationMinutes', {
                                count: activity.durationMinutes,
                            })}
                        </span>
                        <span>{t(`kidsActivities.categories.${activity.category}`)}</span>
                    </p>
                </div>
            </div>

            {activity.instructions && (
                <p className="text-micro text-muted-foreground border-l-2 border-primary/30 pl-2">
                    {activity.instructions}
                </p>
            )}

            {activity.materials.length > 0 && (
                <p className="text-micro text-muted-foreground flex flex-wrap items-center gap-1">
                    <Package className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium">{t('kidsActivities.materials')}</span>
                    {activity.materials.map((item) => (
                        <span
                            key={item}
                            className="rounded-pill bg-surface-2 px-2 py-0.5 text-micro"
                        >
                            {item}
                        </span>
                    ))}
                </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                    {concerned.map((kid) => (
                        <span
                            key={kid.id}
                            className="inline-flex items-center gap-1 rounded-pill bg-primary-soft px-2 py-0.5 text-micro text-primary"
                        >
                            <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ background: kid.color }}
                            />
                            {kid.name}
                        </span>
                    ))}
                </div>

                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSchedule}
                    disabled={scheduled || scheduleActivity.isPending}
                >
                    {scheduled ? (
                        <>
                            <Check className="mr-1.5 h-4 w-4 text-emerald-600" />
                            {t('kidsActivities.scheduled')}
                        </>
                    ) : (
                        <>
                            <CalendarPlus className="mr-1.5 h-4 w-4" />
                            {scheduleActivity.isPending
                                ? t('kidsActivities.scheduling')
                                : t('kidsActivities.schedule')}
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
};

export default KidsActivitiesCard;
