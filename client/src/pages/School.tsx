import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
    addMonths,
    eachDayOfInterval,
    endOfMonth,
    endOfWeek,
    format,
    isSameDay,
    isSameMonth,
    parseISO,
    startOfMonth,
    startOfWeek,
    subMonths,
} from 'date-fns';
import { getDateFnsLocale } from '../lib/dateLocale';
import { api } from '../lib/api';
import {
    AlertTriangle,
    BookOpen,
    Calendar as CalendarIcon,
    CalendarClock,
    ChevronLeft,
    ChevronRight,
    ClipboardList,
    Clock,
    Download,
    GraduationCap,
    Pencil,
    Plus,
    Search,
    Target,
    Trash2,
    TrendingUp,
    Wand2,
} from 'lucide-react';
import {
    Badge,
    Button,
    Card,
    CardContent,
    DatePicker,
    Dialog,
    Input,
    Select,
    Tabs,
    Textarea,
    useToast,
} from '../components/ui';
import EmptyState from '../components/app/EmptyState';
import {
    NO_CLASS_EVENT_TYPES,
    SCHOOL_EVENT_TYPES,
    SCHOOL_STUDY_STATUSES,
    SCHOOL_SUBJECTS,
    SCHOOL_SUPPLY_CATEGORIES,
    type SchoolEvent,
    type SchoolEventType,
    type SchoolGrade,
    type SchoolStudent,
    type SchoolStudySession,
    type SchoolStudyStatus,
    type SchoolSubject,
    type SchoolSupply,
    type SchoolSupplyCategory,
    type StudyPlanSlot,
    useApplySchoolPreset,
    useCompleteStudySession,
    useCreateSchoolEvent,
    useCreateSchoolGrade,
    useCreateSchoolStudent,
    useCreateSchoolSupply,
    useCreateStudySession,
    useDeleteSchoolEvent,
    useDeleteSchoolGrade,
    useDeleteSchoolStudent,
    useDeleteSchoolSupply,
    useDeleteStudySession,
    useGenerateStudyPlan,
    useSchoolEvents,
    useSchoolGrades,
    useSchoolPresets,
    useSchoolStatistics,
    useSchoolStudents,
    useSchoolStudySessions,
    useSchoolSupplies,
    useUpdateSchoolEvent,
    useUpdateSchoolStudent,
    useUpdateSchoolSupply,
    useUpdateStudySession,
} from '../hooks/useSchool';

// =============================================================================
// /school — "École" module.
//
// Five tabs: overview, calendar, supplies checklist, at-home study plan, results.
// Everything is scoped to ONE selected student, picked in the page header, so
// each tab only ever shows one child's year.
//
// Enum values are stored in French; they are translated at render time via
// t('school.<map>.' + value) — never stored translated.
// =============================================================================

const todayKey = (): string => new Date().toISOString().slice(0, 10);

const formatDate = (d: string | null | undefined): string =>
    d ? format(parseISO(d), 'dd MMM yyyy', { locale: getDateFnsLocale() }) : '—';

const formatDayMonth = (d: string | null | undefined): string =>
    d ? format(parseISO(d), 'dd MMM', { locale: getDateFnsLocale() }) : '—';

/** Colour per event type, so the calendar reads at a glance. */
const EVENT_TONE: Record<
    SchoolEventType,
    'default' | 'primary' | 'success' | 'warning' | 'danger'
> = {
    Rentrée: 'primary',
    Pédagogique: 'warning',
    Congé: 'success',
    Examen: 'danger',
    Devoir: 'default',
    Réunion: 'primary',
    Sortie: 'primary',
    Photo: 'default',
    Bulletin: 'primary',
    Autre: 'default',
};

const WEEK_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** Maps the Monday-first display order to Date#getDay() values. */
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0] as const;

const ErrorBanner: React.FC<{ message: string }> = ({ message }) => (
    <div className="flex items-start gap-2 rounded-input border border-danger/30 bg-danger-soft px-4 py-3 text-caption text-danger">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>{message}</span>
    </div>
);

const StatCard: React.FC<{
    label: string;
    value: string | number;
    icon: React.ReactNode;
    tone?: 'default' | 'warning';
}> = ({ label, value, icon, tone = 'default' }) => (
    <Card hover={false}>
        <CardContent className="flex items-center gap-3 p-4">
            <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-card ${
                    tone === 'warning'
                        ? 'bg-warning/10 text-warning'
                        : 'bg-primary-soft text-primary'
                }`}
            >
                {icon}
            </div>
            <div className="min-w-0">
                <p className="truncate text-h2 font-semibold leading-none">{value}</p>
                <p className="mt-1 text-micro text-muted-foreground">{label}</p>
            </div>
        </CardContent>
    </Card>
);

const SectionTitle: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({
    children,
    action,
}) => (
    <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-body font-semibold text-foreground">{children}</h2>
        {action}
    </div>
);

const useSubjectOptions = () => {
    const { t } = useTranslation();
    return useMemo(
        () => SCHOOL_SUBJECTS.map((s) => ({ value: s, label: t(`school.subjects.${s}`) })),
        [t],
    );
};

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

const School: React.FC = () => {
    const { t } = useTranslation();
    const studentsQuery = useSchoolStudents();
    const [studentId, setStudentId] = useState('');
    const [studentDialog, setStudentDialog] = useState<{
        open: boolean;
        edit: SchoolStudent | null;
    }>({ open: false, edit: null });

    const students = useMemo(() => studentsQuery.data ?? [], [studentsQuery.data]);

    // Keep the selection valid: default to the first student, and recover when
    // the selected one is deleted.
    useEffect(() => {
        if (students.length === 0) {
            if (studentId) setStudentId('');
            return;
        }
        if (!students.some((s) => s.id === studentId)) {
            setStudentId(students[0].id);
        }
    }, [students, studentId]);

    const student = students.find((s) => s.id === studentId) ?? null;

    if (studentsQuery.isPending) {
        return (
            <p className="py-10 text-center text-caption text-muted-foreground">
                {t('school.common.loading')}
            </p>
        );
    }
    if (studentsQuery.isError) {
        return (
            <ErrorBanner
                message={
                    studentsQuery.error instanceof Error
                        ? studentsQuery.error.message
                        : t('school.common.error')
                }
            />
        );
    }

    const header = (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
                <h1 className="mb-1 text-h1">{t('school.page.title')}</h1>
                <p className="text-body text-muted-foreground">{t('school.page.subtitle')}</p>
            </div>
            {students.length > 0 && (
                <div className="flex items-end gap-2">
                    <div className="min-w-[180px]">
                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                            {t('school.students.selectLabel')}
                        </label>
                        <Select
                            value={studentId}
                            onValueChange={setStudentId}
                            options={students.map((s) => ({
                                value: s.id,
                                label: s.grade_level ? `${s.name} — ${s.grade_level}` : s.name,
                            }))}
                        />
                    </div>
                    <Button
                        variant="secondary"
                        size="icon"
                        aria-label={t('school.students.edit')}
                        onClick={() => setStudentDialog({ open: true, edit: student })}
                        disabled={!student}
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="secondary"
                        size="icon"
                        aria-label={t('school.students.add')}
                        onClick={() => setStudentDialog({ open: true, edit: null })}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    );

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            {header}

            {!student ? (
                <EmptyState
                    icon={<GraduationCap className="h-8 w-8" />}
                    title={t('school.page.noStudent')}
                    description={t('school.page.noStudentHint')}
                    actionLabel={t('school.page.createStudent')}
                    onAction={() => setStudentDialog({ open: true, edit: null })}
                />
            ) : (
                <Tabs
                    // Remount the tabs when the student changes so each tab's
                    // local state (filters, month cursor…) resets with it.
                    key={student.id}
                    tabs={[
                        {
                            value: 'overview',
                            label: t('school.tabs.overview'),
                            content: <OverviewTab student={student} />,
                        },
                        {
                            value: 'calendar',
                            label: t('school.tabs.calendar'),
                            content: <CalendarTab student={student} />,
                        },
                        {
                            value: 'supplies',
                            label: t('school.tabs.supplies'),
                            content: <SuppliesTab student={student} />,
                        },
                        {
                            value: 'study',
                            label: t('school.tabs.study'),
                            content: <StudyTab student={student} />,
                        },
                        {
                            value: 'results',
                            label: t('school.tabs.results'),
                            content: <ResultsTab student={student} />,
                        },
                    ]}
                />
            )}

            <StudentDialog
                open={studentDialog.open}
                student={studentDialog.edit}
                onClose={() => setStudentDialog({ open: false, edit: null })}
                onCreated={(id) => setStudentId(id)}
            />
        </div>
    );
};

// ---------------------------------------------------------------------------
// Student dialog
// ---------------------------------------------------------------------------

interface FamilyMemberLite {
    id: string;
    name: string;
    color?: string;
}

const StudentDialog: React.FC<{
    open: boolean;
    student: SchoolStudent | null;
    onClose: () => void;
    onCreated: (id: string) => void;
}> = ({ open, student, onClose, onCreated }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const createMut = useCreateSchoolStudent();
    const updateMut = useUpdateSchoolStudent();
    const deleteMut = useDeleteSchoolStudent();

    // The family list is only needed inside this dialog; fetching it here keeps
    // the page's critical path to one request.
    const membersQuery = useQuery({
        queryKey: ['family', 'members-lite'],
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: FamilyMemberLite[] }>('/api/family');
            return r.data;
        },
        enabled: open,
    });

    const defaultYear = useMemo(() => {
        // A school year starts in the summer: before August, we're still in the
        // year that began the previous calendar year.
        const now = new Date();
        const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
        return `${startYear}-${startYear + 1}`;
    }, []);

    const [form, setForm] = useState({
        name: '',
        school_year: defaultYear,
        grade_level: '',
        school_name: '',
        teacher_name: '',
        class_name: '',
        family_member_id: '',
        notes: '',
    });
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open) return;
        setError('');
        setForm({
            name: student?.name ?? '',
            school_year: student?.school_year ?? defaultYear,
            grade_level: student?.grade_level ?? '',
            school_name: student?.school_name ?? '',
            teacher_name: student?.teacher_name ?? '',
            class_name: student?.class_name ?? '',
            family_member_id: student?.family_member_id ?? '',
            notes: student?.notes ?? '',
        });
    }, [open, student, defaultYear]);

    const submit = async () => {
        setError('');
        const payload = {
            name: form.name.trim(),
            school_year: form.school_year.trim(),
            grade_level: form.grade_level.trim() || null,
            school_name: form.school_name.trim() || null,
            teacher_name: form.teacher_name.trim() || null,
            class_name: form.class_name.trim() || null,
            family_member_id: form.family_member_id || null,
            notes: form.notes.trim() || null,
        };
        try {
            if (student) {
                await updateMut.mutateAsync({ id: student.id, patch: payload });
            } else {
                const created = await createMut.mutateAsync(payload);
                onCreated(created.id);
            }
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('school.common.genericError'));
        }
    };

    const remove = async () => {
        if (!student) return;
        if (!window.confirm(t('school.students.deleteConfirm'))) return;
        try {
            await deleteMut.mutateAsync(student.id);
            showToast({ title: t('school.common.delete') });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('school.common.genericError'));
        }
    };

    const memberOptions = [
        { value: '', label: t('school.common.none') },
        ...(membersQuery.data ?? []).map((m) => ({ value: m.id, label: m.name })),
    ];

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => !next && onClose()}
            title={student ? t('school.students.edit') : t('school.students.add')}
        >
            <div className="space-y-4 px-5 py-4 md:px-6">
                {error && <ErrorBanner message={error} />}
                <Input
                    label={t('school.students.name')}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                        label={t('school.students.schoolYear')}
                        value={form.school_year}
                        placeholder="2026-2027"
                        onChange={(e) => setForm({ ...form, school_year: e.target.value })}
                    />
                    <Input
                        label={t('school.students.gradeLevel')}
                        value={form.grade_level}
                        placeholder={t('school.students.gradeLevelPlaceholder')}
                        onChange={(e) => setForm({ ...form, grade_level: e.target.value })}
                    />
                </div>
                <Input
                    label={t('school.students.schoolName')}
                    value={form.school_name}
                    onChange={(e) => setForm({ ...form, school_name: e.target.value })}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                        label={t('school.students.teacher')}
                        value={form.teacher_name}
                        onChange={(e) => setForm({ ...form, teacher_name: e.target.value })}
                    />
                    <Input
                        label={t('school.students.className')}
                        value={form.class_name}
                        onChange={(e) => setForm({ ...form, class_name: e.target.value })}
                    />
                </div>
                <div>
                    <label className="mb-1.5 block text-caption font-medium text-foreground">
                        {t('school.students.linkMember')}
                    </label>
                    <Select
                        value={form.family_member_id}
                        onValueChange={(v) => setForm({ ...form, family_member_id: v })}
                        options={memberOptions}
                    />
                </div>
                <Textarea
                    label={t('school.students.notes')}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
                <p className="text-micro text-muted-foreground">
                    {t('school.students.schoolYearHint')}
                </p>
            </div>
            <div className="flex flex-wrap justify-between gap-2 border-t border-border px-5 py-4 md:px-6">
                {student ? (
                    <Button variant="ghost" className="text-destructive" onClick={remove}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('school.common.delete')}
                    </Button>
                ) : (
                    <span />
                )}
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={onClose}>
                        {t('school.common.cancel')}
                    </Button>
                    <Button
                        onClick={submit}
                        disabled={!form.name.trim() || createMut.isPending || updateMut.isPending}
                    >
                        {t('school.common.save')}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

const OverviewTab: React.FC<{ student: SchoolStudent }> = ({ student }) => {
    const { t } = useTranslation();
    const statsQuery = useSchoolStatistics(student.id);

    if (statsQuery.isPending) {
        return (
            <p className="py-6 text-center text-caption text-muted-foreground">
                {t('school.common.loading')}
            </p>
        );
    }
    if (statsQuery.isError) {
        return (
            <ErrorBanner
                message={
                    statsQuery.error instanceof Error
                        ? statsQuery.error.message
                        : t('school.common.error')
                }
            />
        );
    }

    const stats = statsQuery.data!;
    const { counts } = stats;
    const focus = [...stats.by_subject]
        .filter((s) => s.avg_percentage !== null)
        .sort((a, b) => (a.avg_percentage ?? 0) - (b.avg_percentage ?? 0))
        .slice(0, 5);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                    label={t('school.stats.suppliesProgress')}
                    value={`${counts.supplies_purchased}/${counts.supplies_total}`}
                    icon={<ClipboardList className="h-5 w-5" />}
                />
                <StatCard
                    label={t('school.stats.eventsNext7d')}
                    value={counts.events_next_7d}
                    icon={<CalendarIcon className="h-5 w-5" />}
                />
                <StatCard
                    label={t('school.stats.sessionsToday')}
                    value={counts.sessions_today}
                    icon={<BookOpen className="h-5 w-5" />}
                />
                <StatCard
                    label={t('school.stats.minutesDone7d')}
                    value={`${counts.minutes_done_7d} ${t('school.common.minutes')}`}
                    icon={<Clock className="h-5 w-5" />}
                    tone={counts.sessions_late > 0 ? 'warning' : 'default'}
                />
            </div>

            {counts.sessions_late > 0 && (
                <div className="flex items-center gap-2 rounded-input border border-warning/30 bg-warning/10 px-4 py-3 text-caption text-warning">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>
                        {t('school.stats.sessionsLate')} : {counts.sessions_late}
                    </span>
                </div>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <section>
                    <SectionTitle>{t('school.overview.upcomingEvents')}</SectionTitle>
                    {stats.upcoming_events.length === 0 ? (
                        <p className="text-caption text-muted-foreground">
                            {t('school.overview.noEvents')}
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {stats.upcoming_events.map((e) => (
                                <Card hover={false} key={e.id}>
                                    <CardContent className="flex items-center justify-between gap-3 p-4">
                                        <div className="min-w-0">
                                            <p className="truncate text-caption font-medium">
                                                {e.title}
                                            </p>
                                            <p className="text-micro text-muted-foreground">
                                                {formatDate(e.start_date)}
                                                {e.end_date && e.end_date !== e.start_date
                                                    ? ` → ${formatDate(e.end_date)}`
                                                    : ''}
                                            </p>
                                        </div>
                                        <Badge variant={EVENT_TONE[e.event_type]}>
                                            {t(`school.eventTypes.${e.event_type}`)}
                                        </Badge>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                    <p className="mt-3 text-micro text-muted-foreground">
                        {t('school.overview.reminderNote')}
                    </p>
                </section>

                <section>
                    <SectionTitle>{t('school.overview.upcomingSessions')}</SectionTitle>
                    {stats.upcoming_sessions.length === 0 ? (
                        <p className="text-caption text-muted-foreground">
                            {t('school.overview.noSessions')}
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {stats.upcoming_sessions.map((s) => (
                                <Card hover={false} key={s.id}>
                                    <CardContent className="flex items-center justify-between gap-3 p-4">
                                        <div className="min-w-0">
                                            <p className="truncate text-caption font-medium">
                                                {s.title}
                                            </p>
                                            <p className="text-micro text-muted-foreground">
                                                {formatDate(s.scheduled_date)}
                                                {s.start_time ? ` · ${s.start_time}` : ''} ·{' '}
                                                {s.duration_minutes} {t('school.common.minutes')}
                                            </p>
                                        </div>
                                        <Badge variant="primary">
                                            {t(`school.subjects.${s.subject}`)}
                                        </Badge>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            <section>
                <SectionTitle>{t('school.overview.focus')}</SectionTitle>
                {focus.length === 0 ? (
                    <p className="text-caption text-muted-foreground">
                        {t('school.overview.noFocus')}
                    </p>
                ) : (
                    <div className="space-y-2">
                        {focus.map((s) => (
                            <Card hover={false} key={s.subject}>
                                <CardContent className="p-4">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-caption font-medium">
                                            {t(`school.subjects.${s.subject}`)}
                                        </span>
                                        <span className="text-caption font-semibold">
                                            {s.avg_percentage}%
                                        </span>
                                    </div>
                                    <div className="h-2 w-full overflow-hidden rounded-pill bg-surface-2">
                                        <div
                                            className={`h-full rounded-pill ${
                                                (s.avg_percentage ?? 0) < 60
                                                    ? 'bg-danger'
                                                    : (s.avg_percentage ?? 0) < 75
                                                      ? 'bg-warning'
                                                      : 'bg-success'
                                            }`}
                                            style={{
                                                width: `${Math.min(100, s.avg_percentage ?? 0)}%`,
                                            }}
                                        />
                                    </div>
                                    <p className="mt-2 text-micro text-muted-foreground">
                                        {t('school.results.gradesCount', { count: s.grades_count })}{' '}
                                        · {t('school.results.studyTime')} : {s.minutes_done}{' '}
                                        {t('school.common.minutes')}
                                    </p>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
                <p className="mt-3 text-micro text-muted-foreground">
                    {t('school.overview.focusHint')}
                </p>
            </section>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Calendar tab
// ---------------------------------------------------------------------------

const CalendarTab: React.FC<{ student: SchoolStudent }> = ({ student }) => {
    const { t } = useTranslation();
    const [cursor, setCursor] = useState(new Date());
    const [dialog, setDialog] = useState<{
        open: boolean;
        event: SchoolEvent | null;
        date: string;
    }>({ open: false, event: null, date: todayKey() });

    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

    const eventsQuery = useSchoolEvents({
        student_id: student.id,
        from: format(gridStart, 'yyyy-MM-dd'),
        to: format(gridEnd, 'yyyy-MM-dd'),
    });
    const upcomingQuery = useSchoolEvents({ student_id: student.id, scope: 'upcoming' });

    const events = eventsQuery.data ?? [];

    const eventsForDay = (day: Date): SchoolEvent[] => {
        const key = format(day, 'yyyy-MM-dd');
        return events.filter((e) => key >= e.start_date && key <= (e.end_date ?? e.start_date));
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Button
                        variant="secondary"
                        size="icon"
                        aria-label="←"
                        onClick={() => setCursor(subMonths(cursor, 1))}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="min-w-[150px] text-center text-body font-semibold capitalize">
                        {format(cursor, 'MMMM yyyy', { locale: getDateFnsLocale() })}
                    </span>
                    <Button
                        variant="secondary"
                        size="icon"
                        aria-label="→"
                        onClick={() => setCursor(addMonths(cursor, 1))}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" onClick={() => setCursor(new Date())}>
                        {t('school.calendar.today')}
                    </Button>
                </div>
                <Button
                    onClick={() =>
                        setDialog({ open: true, event: null, date: format(cursor, 'yyyy-MM-dd') })
                    }
                >
                    <Plus className="mr-2 h-4 w-4" />
                    {t('school.calendar.addEvent')}
                </Button>
            </div>

            {eventsQuery.isError && <ErrorBanner message={t('school.common.error')} />}

            <Card hover={false}>
                <CardContent className="p-3 md:p-4">
                    <div className="grid grid-cols-7 gap-1 md:gap-2">
                        {WEEK_DAY_KEYS.map((d) => (
                            <div
                                key={d}
                                className="py-2 text-center text-micro font-semibold text-muted-foreground"
                            >
                                {t(`calendar.week_days.${d}`)}
                            </div>
                        ))}
                        {days.map((day) => {
                            const dayEvents = eventsForDay(day);
                            const noClass = dayEvents.some((e) =>
                                NO_CLASS_EVENT_TYPES.includes(e.event_type),
                            );
                            const isToday = isSameDay(day, new Date());
                            return (
                                <button
                                    key={day.toISOString()}
                                    type="button"
                                    onClick={() =>
                                        setDialog({
                                            open: true,
                                            event: null,
                                            date: format(day, 'yyyy-MM-dd'),
                                        })
                                    }
                                    className={`min-h-[68px] rounded-input border p-1.5 text-left transition-colors md:min-h-[92px] ${
                                        isSameMonth(day, cursor)
                                            ? 'border-border'
                                            : 'border-transparent opacity-40'
                                    } ${noClass ? 'bg-success/10' : 'hover:bg-surface-2'}`}
                                >
                                    <span
                                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-micro font-semibold ${
                                            isToday
                                                ? 'bg-primary text-primary-foreground'
                                                : 'text-muted-foreground'
                                        }`}
                                    >
                                        {format(day, 'd')}
                                    </span>
                                    <div className="mt-1 space-y-0.5">
                                        {dayEvents.slice(0, 2).map((e) => (
                                            <span
                                                key={e.id}
                                                className="block truncate rounded-sm bg-surface-2 px-1 text-micro"
                                                title={e.title}
                                            >
                                                {e.title}
                                            </span>
                                        ))}
                                        {dayEvents.length > 2 && (
                                            <span className="block px-1 text-micro text-muted-foreground">
                                                +{dayEvents.length - 2}
                                            </span>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            <section>
                <SectionTitle>{t('school.calendar.upcoming')}</SectionTitle>
                {(upcomingQuery.data ?? []).length === 0 ? (
                    <p className="text-caption text-muted-foreground">
                        {t('school.calendar.noUpcoming')}
                    </p>
                ) : (
                    <div className="space-y-2">
                        {(upcomingQuery.data ?? []).map((e) => (
                            <Card hover={false} key={e.id}>
                                <CardContent className="flex items-center justify-between gap-3 p-4">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="truncate text-caption font-medium">
                                                {e.title}
                                            </span>
                                            <Badge variant={EVENT_TONE[e.event_type]}>
                                                {t(`school.eventTypes.${e.event_type}`)}
                                            </Badge>
                                            {e.reminder_enabled && (
                                                <Badge variant="secondary">
                                                    <CalendarClock className="mr-1 h-3 w-3" />
                                                    {e.reminder_days_before === 0
                                                        ? t('school.calendar.reminderSameDay')
                                                        : e.reminder_days_before === 1
                                                          ? t('school.calendar.reminderDayBefore')
                                                          : t('school.calendar.reminderDays', {
                                                                count: e.reminder_days_before,
                                                            })}
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="mt-1 text-micro text-muted-foreground">
                                            {formatDate(e.start_date)}
                                            {e.end_date && e.end_date !== e.start_date
                                                ? ` → ${formatDate(e.end_date)}`
                                                : ''}
                                            {e.start_time ? ` · ${e.start_time}` : ''}
                                            {e.location ? ` · ${e.location}` : ''}
                                        </p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t('school.common.edit')}
                                        onClick={() =>
                                            setDialog({ open: true, event: e, date: e.start_date })
                                        }
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </section>

            <EventDialog
                open={dialog.open}
                event={dialog.event}
                defaultDate={dialog.date}
                studentId={student.id}
                onClose={() => setDialog({ open: false, event: null, date: todayKey() })}
            />
        </div>
    );
};

const EventDialog: React.FC<{
    open: boolean;
    event: SchoolEvent | null;
    defaultDate: string;
    studentId: string;
    onClose: () => void;
}> = ({ open, event, defaultDate, studentId, onClose }) => {
    const { t } = useTranslation();
    const createMut = useCreateSchoolEvent();
    const updateMut = useUpdateSchoolEvent();
    const deleteMut = useDeleteSchoolEvent();
    const [error, setError] = useState('');
    const [form, setForm] = useState({
        title: '',
        event_type: 'Autre' as SchoolEventType,
        start_date: defaultDate,
        end_date: '',
        start_time: '',
        location: '',
        notes: '',
        reminder_enabled: true,
        reminder_days_before: '1',
    });

    useEffect(() => {
        if (!open) return;
        setError('');
        setForm({
            title: event?.title ?? '',
            event_type: event?.event_type ?? 'Autre',
            start_date: event?.start_date ?? defaultDate,
            end_date: event?.end_date ?? '',
            start_time: event?.start_time ?? '',
            location: event?.location ?? '',
            notes: event?.notes ?? '',
            reminder_enabled: event?.reminder_enabled ?? true,
            reminder_days_before: String(event?.reminder_days_before ?? 1),
        });
    }, [open, event, defaultDate]);

    const submit = async () => {
        setError('');
        const payload = {
            title: form.title.trim(),
            event_type: form.event_type,
            start_date: form.start_date,
            end_date: form.end_date || null,
            start_time: form.start_time || null,
            location: form.location.trim() || null,
            notes: form.notes.trim() || null,
            reminder_enabled: form.reminder_enabled,
            reminder_days_before: Number(form.reminder_days_before),
        };
        try {
            if (event) {
                await updateMut.mutateAsync({ id: event.id, patch: payload });
            } else {
                await createMut.mutateAsync({ ...payload, student_id: studentId });
            }
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('school.common.genericError'));
        }
    };

    const remove = async () => {
        if (!event) return;
        if (!window.confirm(t('school.calendar.deleteConfirm'))) return;
        try {
            await deleteMut.mutateAsync(event.id);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('school.common.genericError'));
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => !next && onClose()}
            title={event ? t('school.calendar.editEvent') : t('school.calendar.addEvent')}
        >
            <div className="space-y-4 px-5 py-4 md:px-6">
                {error && <ErrorBanner message={error} />}
                <Input
                    label={t('school.calendar.eventTitle')}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
                <div>
                    <label className="mb-1.5 block text-caption font-medium text-foreground">
                        {t('school.calendar.type')}
                    </label>
                    <Select
                        value={form.event_type}
                        onValueChange={(v) =>
                            setForm({ ...form, event_type: v as SchoolEventType })
                        }
                        options={SCHOOL_EVENT_TYPES.map((v) => ({
                            value: v,
                            label: t(`school.eventTypes.${v}`),
                        }))}
                    />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <DatePicker
                        label={t('school.calendar.startDate')}
                        value={form.start_date}
                        onChange={(v) => setForm({ ...form, start_date: v })}
                    />
                    <DatePicker
                        label={`${t('school.calendar.endDate')} (${t('school.common.optional')})`}
                        value={form.end_date}
                        onChange={(v) => setForm({ ...form, end_date: v })}
                    />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <DatePicker
                        label={`${t('school.calendar.startTime')} (${t('school.common.optional')})`}
                        type="time"
                        value={form.start_time}
                        onChange={(v) => setForm({ ...form, start_time: v })}
                    />
                    <Input
                        label={t('school.calendar.location')}
                        value={form.location}
                        onChange={(e) => setForm({ ...form, location: e.target.value })}
                    />
                </div>
                <Textarea
                    label={t('school.calendar.notes')}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
                <label className="flex items-center gap-2 text-caption">
                    <input
                        type="checkbox"
                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                        checked={form.reminder_enabled}
                        onChange={(e) => setForm({ ...form, reminder_enabled: e.target.checked })}
                    />
                    {t('school.calendar.reminderEnabled')}
                </label>
                {form.reminder_enabled && (
                    <div>
                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                            {t('school.calendar.reminderDaysBefore')}
                        </label>
                        <Select
                            value={form.reminder_days_before}
                            onValueChange={(v) => setForm({ ...form, reminder_days_before: v })}
                            options={[
                                { value: '0', label: t('school.calendar.reminderSameDay') },
                                { value: '1', label: t('school.calendar.reminderDayBefore') },
                                ...[2, 3, 7, 14].map((n) => ({
                                    value: String(n),
                                    label: t('school.calendar.reminderDays', { count: n }),
                                })),
                            ]}
                        />
                    </div>
                )}
            </div>
            <div className="flex flex-wrap justify-between gap-2 border-t border-border px-5 py-4 md:px-6">
                {event ? (
                    <Button variant="ghost" className="text-destructive" onClick={remove}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('school.common.delete')}
                    </Button>
                ) : (
                    <span />
                )}
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={onClose}>
                        {t('school.common.cancel')}
                    </Button>
                    <Button
                        onClick={submit}
                        disabled={
                            !form.title.trim() ||
                            !form.start_date ||
                            createMut.isPending ||
                            updateMut.isPending
                        }
                    >
                        {t('school.common.save')}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};

// ---------------------------------------------------------------------------
// Supplies tab
// ---------------------------------------------------------------------------

const SuppliesTab: React.FC<{ student: SchoolStudent }> = ({ student }) => {
    const { t } = useTranslation();
    const [filter, setFilter] = useState<'all' | 'todo' | 'done'>('all');
    const [search, setSearch] = useState('');
    const [dialog, setDialog] = useState<{ open: boolean; supply: SchoolSupply | null }>({
        open: false,
        supply: null,
    });
    const [presetOpen, setPresetOpen] = useState(false);

    const suppliesQuery = useSchoolSupplies({
        student_id: student.id,
        purchased: filter === 'all' ? undefined : filter === 'done' ? 'true' : 'false',
        q: search.trim() || undefined,
    });
    const updateMut = useUpdateSchoolSupply();
    const deleteMut = useDeleteSchoolSupply();

    const supplies = suppliesQuery.data ?? [];
    // The progress bar must reflect the whole list, not the active filter.
    const allQuery = useSchoolSupplies({ student_id: student.id });
    const all = allQuery.data ?? [];
    const done = all.filter((s) => s.is_purchased).length;
    const cost = all.reduce((sum, s) => sum + (s.unit_price ?? 0) * s.quantity, 0);

    const grouped = useMemo(() => {
        const map = new Map<SchoolSupplyCategory, SchoolSupply[]>();
        for (const s of supplies) {
            const list = map.get(s.category) ?? [];
            list.push(s);
            map.set(s.category, list);
        }
        return [...map.entries()];
    }, [supplies]);

    const toggle = async (supply: SchoolSupply) => {
        try {
            await updateMut.mutateAsync({
                id: supply.id,
                patch: { is_purchased: !supply.is_purchased },
            });
        } catch {
            // The list re-renders from the server state; a failed toggle simply
            // leaves the checkbox where it was.
        }
    };

    const remove = async (supply: SchoolSupply) => {
        if (!window.confirm(t('school.supplies.deleteConfirm'))) return;
        await deleteMut.mutateAsync(supply.id).catch(() => undefined);
    };

    return (
        <div className="space-y-5">
            <Card hover={false}>
                <CardContent className="p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-caption font-medium">
                            {t('school.supplies.progress', { done, total: all.length })}
                        </span>
                        {cost > 0 && (
                            <span className="text-caption text-muted-foreground">
                                {t('school.supplies.totalCost')} : {cost.toFixed(2)}
                            </span>
                        )}
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-pill bg-surface-2">
                        <div
                            className="h-full rounded-pill bg-success transition-all"
                            style={{
                                width: `${all.length ? (done / all.length) * 100 : 0}%`,
                            }}
                        />
                    </div>
                </CardContent>
            </Card>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        className="pl-9"
                        placeholder={t('school.supplies.search')}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="w-[150px]">
                    <Select
                        value={filter}
                        onValueChange={(v) => setFilter(v as 'all' | 'todo' | 'done')}
                        options={[
                            { value: 'all', label: t('school.supplies.filterAll') },
                            { value: 'todo', label: t('school.supplies.filterTodo') },
                            { value: 'done', label: t('school.supplies.filterDone') },
                        ]}
                    />
                </div>
                <Button variant="secondary" onClick={() => setPresetOpen(true)}>
                    <Download className="mr-2 h-4 w-4" />
                    {t('school.presets.import')}
                </Button>
                <Button onClick={() => setDialog({ open: true, supply: null })}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t('school.supplies.add')}
                </Button>
            </div>

            {suppliesQuery.isError && <ErrorBanner message={t('school.common.error')} />}

            {supplies.length === 0 ? (
                <EmptyState
                    icon={<ClipboardList className="h-8 w-8" />}
                    title={t('school.supplies.empty')}
                    description={t('school.supplies.emptyHint')}
                    actionLabel={t('school.presets.import')}
                    onAction={() => setPresetOpen(true)}
                />
            ) : (
                grouped.map(([category, items]) => (
                    <section key={category}>
                        <SectionTitle>{t(`school.supplyCategories.${category}`)}</SectionTitle>
                        <div className="space-y-2">
                            {items.map((s) => (
                                <Card hover={false} key={s.id}>
                                    <CardContent className="flex items-start gap-3 p-4">
                                        <input
                                            type="checkbox"
                                            className="mt-1 h-5 w-5 flex-shrink-0 accent-[hsl(var(--primary))]"
                                            checked={s.is_purchased}
                                            onChange={() => toggle(s)}
                                            aria-label={s.label}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <p
                                                className={`text-caption font-medium ${
                                                    s.is_purchased
                                                        ? 'text-muted-foreground line-through'
                                                        : ''
                                                }`}
                                            >
                                                {s.quantity > 1 ? `${s.quantity} × ` : ''}
                                                {s.label}
                                            </p>
                                            <p className="mt-0.5 text-micro text-muted-foreground">
                                                {[
                                                    s.isbn ? `ISBN ${s.isbn}` : null,
                                                    s.subject
                                                        ? t(`school.subjects.${s.subject}`)
                                                        : null,
                                                    s.store,
                                                    s.unit_price != null
                                                        ? s.unit_price.toFixed(2)
                                                        : null,
                                                    s.is_purchased && s.purchased_at
                                                        ? t('school.supplies.purchasedOn', {
                                                              date: formatDayMonth(s.purchased_at),
                                                          })
                                                        : null,
                                                ]
                                                    .filter(Boolean)
                                                    .join(' · ')}
                                            </p>
                                            {s.notes && (
                                                <p className="mt-1 text-micro italic text-muted-foreground">
                                                    {s.notes}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex flex-shrink-0 gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label={t('school.common.edit')}
                                                onClick={() => setDialog({ open: true, supply: s })}
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label={t('school.common.delete')}
                                                className="text-destructive"
                                                onClick={() => remove(s)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </section>
                ))
            )}

            <SupplyDialog
                open={dialog.open}
                supply={dialog.supply}
                studentId={student.id}
                onClose={() => setDialog({ open: false, supply: null })}
            />
            <PresetDialog
                open={presetOpen}
                studentId={student.id}
                onClose={() => setPresetOpen(false)}
            />
        </div>
    );
};

const SupplyDialog: React.FC<{
    open: boolean;
    supply: SchoolSupply | null;
    studentId: string;
    onClose: () => void;
}> = ({ open, supply, studentId, onClose }) => {
    const { t } = useTranslation();
    const subjectOptions = useSubjectOptions();
    const createMut = useCreateSchoolSupply();
    const updateMut = useUpdateSchoolSupply();
    const [error, setError] = useState('');
    const [form, setForm] = useState({
        label: '',
        category: 'Fourniture' as SchoolSupplyCategory,
        quantity: '1',
        isbn: '',
        subject: '',
        store: '',
        unit_price: '',
        notes: '',
    });

    useEffect(() => {
        if (!open) return;
        setError('');
        setForm({
            label: supply?.label ?? '',
            category: supply?.category ?? 'Fourniture',
            quantity: String(supply?.quantity ?? 1),
            isbn: supply?.isbn ?? '',
            subject: supply?.subject ?? '',
            store: supply?.store ?? '',
            unit_price: supply?.unit_price != null ? String(supply.unit_price) : '',
            notes: supply?.notes ?? '',
        });
    }, [open, supply]);

    const submit = async () => {
        setError('');
        const price = form.unit_price.trim() ? Number(form.unit_price) : null;
        const payload = {
            label: form.label.trim(),
            category: form.category,
            quantity: Math.max(1, Number(form.quantity) || 1),
            isbn: form.isbn.trim() || null,
            subject: (form.subject || null) as SchoolSubject | null,
            store: form.store.trim() || null,
            unit_price: price !== null && Number.isFinite(price) ? price : null,
            notes: form.notes.trim() || null,
        };
        try {
            if (supply) {
                await updateMut.mutateAsync({ id: supply.id, patch: payload });
            } else {
                await createMut.mutateAsync({ ...payload, student_id: studentId });
            }
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('school.common.genericError'));
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => !next && onClose()}
            title={supply ? t('school.supplies.edit') : t('school.supplies.add')}
        >
            <div className="space-y-4 px-5 py-4 md:px-6">
                {error && <ErrorBanner message={error} />}
                <Input
                    label={t('school.supplies.label')}
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                            {t('school.supplies.category')}
                        </label>
                        <Select
                            value={form.category}
                            onValueChange={(v) =>
                                setForm({ ...form, category: v as SchoolSupplyCategory })
                            }
                            options={SCHOOL_SUPPLY_CATEGORIES.map((c) => ({
                                value: c,
                                label: t(`school.supplyCategories.${c}`),
                            }))}
                        />
                    </div>
                    <Input
                        label={t('school.supplies.quantity')}
                        type="number"
                        min={1}
                        value={form.quantity}
                        onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                    />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                        label={t('school.supplies.isbn')}
                        value={form.isbn}
                        onChange={(e) => setForm({ ...form, isbn: e.target.value })}
                    />
                    <div>
                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                            {t('school.supplies.subject')}
                        </label>
                        <Select
                            value={form.subject}
                            onValueChange={(v) => setForm({ ...form, subject: v })}
                            options={[
                                { value: '', label: t('school.common.none') },
                                ...subjectOptions,
                            ]}
                        />
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                        label={t('school.supplies.store')}
                        value={form.store}
                        onChange={(e) => setForm({ ...form, store: e.target.value })}
                    />
                    <Input
                        label={t('school.supplies.unitPrice')}
                        type="number"
                        step="0.01"
                        min={0}
                        value={form.unit_price}
                        onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
                    />
                </div>
                <Textarea
                    label={t('school.supplies.notes')}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4 md:px-6">
                <Button variant="secondary" onClick={onClose}>
                    {t('school.common.cancel')}
                </Button>
                <Button
                    onClick={submit}
                    disabled={!form.label.trim() || createMut.isPending || updateMut.isPending}
                >
                    {t('school.common.save')}
                </Button>
            </div>
        </Dialog>
    );
};

const PresetDialog: React.FC<{ open: boolean; studentId: string; onClose: () => void }> = ({
    open,
    studentId,
    onClose,
}) => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const presetsQuery = useSchoolPresets();
    const applyMut = useApplySchoolPreset();
    const [selected, setSelected] = useState('');
    const [withEvents, setWithEvents] = useState(true);
    const [withSupplies, setWithSupplies] = useState(true);
    const [error, setError] = useState('');

    const presets = presetsQuery.data ?? [];
    const preset = presets.find((p) => p.id === selected) ?? presets[0] ?? null;

    useEffect(() => {
        if (open && !selected && presets.length > 0) setSelected(presets[0].id);
    }, [open, selected, presets]);

    const apply = async () => {
        if (!preset) return;
        setError('');
        try {
            const result = await applyMut.mutateAsync({
                presetId: preset.id,
                student_id: studentId,
                include_events: withEvents,
                include_supplies: withSupplies,
            });
            const skipped = result.events_skipped + result.supplies_skipped;
            showToast({
                title: t('school.presets.result', {
                    events: result.events_created,
                    supplies: result.supplies_created,
                }),
                description:
                    skipped > 0
                        ? t('school.presets.resultSkipped', { count: skipped })
                        : result.caveat,
            });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('school.common.genericError'));
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => !next && onClose()}
            title={t('school.presets.title')}
            description={t('school.presets.description')}
        >
            <div className="space-y-4 px-5 py-4 md:px-6">
                {error && <ErrorBanner message={error} />}
                {presets.length === 0 ? (
                    <p className="text-caption text-muted-foreground">
                        {t('school.presets.empty')}
                    </p>
                ) : (
                    <>
                        <Select
                            value={preset?.id ?? ''}
                            onValueChange={setSelected}
                            options={presets.map((p) => ({ value: p.id, label: p.label }))}
                        />
                        {preset && (
                            <>
                                <p className="text-caption text-muted-foreground">
                                    {preset.description}
                                </p>
                                <label className="flex items-center gap-2 text-caption">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                                        checked={withEvents}
                                        onChange={(e) => setWithEvents(e.target.checked)}
                                    />
                                    {t('school.presets.includeEvents', {
                                        count: preset.events_count,
                                    })}
                                </label>
                                <label className="flex items-center gap-2 text-caption">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                                        checked={withSupplies}
                                        onChange={(e) => setWithSupplies(e.target.checked)}
                                    />
                                    {t('school.presets.includeSupplies', {
                                        count: preset.supplies_count,
                                    })}
                                </label>
                                <div className="rounded-input border border-warning/30 bg-warning/10 px-4 py-3 text-micro text-warning">
                                    <p className="mb-1 font-semibold">
                                        {t('school.presets.caveatTitle')}
                                    </p>
                                    {preset.caveat}
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4 md:px-6">
                <Button variant="secondary" onClick={onClose}>
                    {t('school.common.cancel')}
                </Button>
                <Button
                    onClick={apply}
                    disabled={!preset || applyMut.isPending || (!withEvents && !withSupplies)}
                >
                    {applyMut.isPending ? t('school.presets.applying') : t('school.presets.apply')}
                </Button>
            </div>
        </Dialog>
    );
};

// ---------------------------------------------------------------------------
// Study tab
// ---------------------------------------------------------------------------

const StudyTab: React.FC<{ student: SchoolStudent }> = ({ student }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const [status, setStatus] = useState<SchoolStudyStatus | 'all'>('Planifiée');
    const [dialog, setDialog] = useState<{ open: boolean; session: SchoolStudySession | null }>({
        open: false,
        session: null,
    });
    const [plannerOpen, setPlannerOpen] = useState(false);

    const sessionsQuery = useSchoolStudySessions({ student_id: student.id, status });
    const completeMut = useCompleteStudySession();
    const deleteMut = useDeleteStudySession();

    const sessions = sessionsQuery.data ?? [];
    const today = todayKey();

    const complete = async (session: SchoolStudySession) => {
        const raw = window.prompt(
            `${t('school.study.mastery')} (1-5) — ${t('school.study.masteryHint')}`,
            '3',
        );
        // Cancel leaves the session untouched; anything unparseable is ignored
        // and the session is simply marked done without a mastery score.
        if (raw === null) return;
        const parsed = Number(raw);
        const mastery = Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : undefined;
        try {
            const result = await completeMut.mutateAsync({ id: session.id, mastery });
            showToast({
                title: t('school.study.completedToast'),
                description: result.next_occurrence?.scheduled_date
                    ? t('school.study.nextOccurrence', {
                          date: formatDate(result.next_occurrence.scheduled_date),
                      })
                    : undefined,
            });
        } catch (err) {
            window.alert(err instanceof Error ? err.message : t('school.common.genericError'));
        }
    };

    const remove = async (session: SchoolStudySession) => {
        if (!window.confirm(t('school.study.deleteConfirm'))) return;
        await deleteMut.mutateAsync(session.id).catch(() => undefined);
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
                <div className="w-[170px]">
                    <Select
                        value={status}
                        onValueChange={(v) => setStatus(v as SchoolStudyStatus | 'all')}
                        options={[
                            { value: 'all', label: t('school.common.all') },
                            ...SCHOOL_STUDY_STATUSES.map((s) => ({
                                value: s,
                                label: t(`school.studyStatuses.${s}`),
                            })),
                        ]}
                    />
                </div>
                <div className="flex-1" />
                <Button variant="secondary" onClick={() => setPlannerOpen(true)}>
                    <Wand2 className="mr-2 h-4 w-4" />
                    {t('school.study.planner')}
                </Button>
                <Button onClick={() => setDialog({ open: true, session: null })}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t('school.study.add')}
                </Button>
            </div>

            {sessionsQuery.isError && <ErrorBanner message={t('school.common.error')} />}

            {sessions.length === 0 ? (
                <EmptyState
                    icon={<BookOpen className="h-8 w-8" />}
                    title={t('school.study.empty')}
                    description={t('school.study.emptyHint')}
                    actionLabel={t('school.study.planner')}
                    onAction={() => setPlannerOpen(true)}
                />
            ) : (
                <div className="space-y-2">
                    {sessions.map((s) => {
                        const late = s.status === 'Planifiée' && s.scheduled_date < today;
                        return (
                            <Card hover={false} key={s.id}>
                                <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="truncate text-caption font-medium">
                                                {s.title}
                                            </span>
                                            <Badge variant="primary">
                                                {t(`school.subjects.${s.subject}`)}
                                            </Badge>
                                            {late && (
                                                <Badge variant="danger">
                                                    {t('school.study.late')}
                                                </Badge>
                                            )}
                                            {s.status === 'Faite' && (
                                                <Badge variant="success">
                                                    {t('school.studyStatuses.Faite')}
                                                    {s.mastery ? ` · ${s.mastery}/5` : ''}
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="mt-1 text-micro text-muted-foreground">
                                            {formatDate(s.scheduled_date)}
                                            {s.start_time ? ` · ${s.start_time}` : ''} ·{' '}
                                            {s.duration_minutes} {t('school.common.minutes')}
                                            {s.recurrence_days
                                                ? ` · ${
                                                      s.recurrence_days === 7
                                                          ? t('school.study.recurrenceWeekly')
                                                          : t('school.study.recurrenceBiweekly')
                                                  }`
                                                : ''}
                                        </p>
                                        {s.objective && (
                                            <p className="mt-1 flex items-start gap-1 text-micro text-muted-foreground">
                                                <Target className="mt-0.5 h-3 w-3 flex-shrink-0" />
                                                {s.objective}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex flex-shrink-0 gap-1">
                                        {s.status !== 'Faite' && (
                                            <Button variant="secondary" onClick={() => complete(s)}>
                                                {t('school.study.complete')}
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={t('school.common.edit')}
                                            onClick={() => setDialog({ open: true, session: s })}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={t('school.common.delete')}
                                            className="text-destructive"
                                            onClick={() => remove(s)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            <SessionDialog
                open={dialog.open}
                session={dialog.session}
                studentId={student.id}
                onClose={() => setDialog({ open: false, session: null })}
            />
            <PlannerDialog
                open={plannerOpen}
                studentId={student.id}
                onClose={() => setPlannerOpen(false)}
            />
        </div>
    );
};

const SessionDialog: React.FC<{
    open: boolean;
    session: SchoolStudySession | null;
    studentId: string;
    onClose: () => void;
}> = ({ open, session, studentId, onClose }) => {
    const { t } = useTranslation();
    const subjectOptions = useSubjectOptions();
    const createMut = useCreateStudySession();
    const updateMut = useUpdateStudySession();
    const [error, setError] = useState('');
    const [form, setForm] = useState({
        subject: 'Mathématique' as SchoolSubject,
        title: '',
        scheduled_date: todayKey(),
        start_time: '',
        duration_minutes: '30',
        objective: '',
        recurrence_days: '',
        reminder_enabled: true,
        notes: '',
    });

    useEffect(() => {
        if (!open) return;
        setError('');
        setForm({
            subject: session?.subject ?? 'Mathématique',
            title: session?.title ?? '',
            scheduled_date: session?.scheduled_date ?? todayKey(),
            start_time: session?.start_time ?? '',
            duration_minutes: String(session?.duration_minutes ?? 30),
            objective: session?.objective ?? '',
            recurrence_days: session?.recurrence_days ? String(session.recurrence_days) : '',
            reminder_enabled: session?.reminder_enabled ?? true,
            notes: session?.notes ?? '',
        });
    }, [open, session]);

    const submit = async () => {
        setError('');
        const payload = {
            subject: form.subject,
            title: form.title.trim(),
            scheduled_date: form.scheduled_date,
            start_time: form.start_time || null,
            duration_minutes: Math.min(480, Math.max(5, Number(form.duration_minutes) || 30)),
            objective: form.objective.trim() || null,
            recurrence_days: form.recurrence_days ? Number(form.recurrence_days) : null,
            reminder_enabled: form.reminder_enabled,
            notes: form.notes.trim() || null,
        };
        try {
            if (session) {
                await updateMut.mutateAsync({ id: session.id, patch: payload });
            } else {
                await createMut.mutateAsync({ ...payload, student_id: studentId });
            }
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('school.common.genericError'));
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => !next && onClose()}
            title={session ? t('school.study.edit') : t('school.study.add')}
        >
            <div className="space-y-4 px-5 py-4 md:px-6">
                {error && <ErrorBanner message={error} />}
                <div>
                    <label className="mb-1.5 block text-caption font-medium text-foreground">
                        {t('school.study.subject')}
                    </label>
                    <Select
                        value={form.subject}
                        onValueChange={(v) => setForm({ ...form, subject: v as SchoolSubject })}
                        options={subjectOptions}
                    />
                </div>
                <Input
                    label={t('school.study.sessionTitle')}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <DatePicker
                        label={t('school.study.date')}
                        value={form.scheduled_date}
                        onChange={(v) => setForm({ ...form, scheduled_date: v })}
                    />
                    <DatePicker
                        label={t('school.study.time')}
                        type="time"
                        value={form.start_time}
                        onChange={(v) => setForm({ ...form, start_time: v })}
                    />
                    <Input
                        label={t('school.study.duration')}
                        type="number"
                        min={5}
                        max={480}
                        value={form.duration_minutes}
                        onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
                    />
                </div>
                <Textarea
                    label={t('school.study.objective')}
                    placeholder={t('school.study.objectivePlaceholder')}
                    value={form.objective}
                    onChange={(e) => setForm({ ...form, objective: e.target.value })}
                />
                <div>
                    <label className="mb-1.5 block text-caption font-medium text-foreground">
                        {t('school.study.recurrence')}
                    </label>
                    <Select
                        value={form.recurrence_days}
                        onValueChange={(v) => setForm({ ...form, recurrence_days: v })}
                        options={[
                            { value: '', label: t('school.study.recurrenceNone') },
                            { value: '7', label: t('school.study.recurrenceWeekly') },
                            { value: '14', label: t('school.study.recurrenceBiweekly') },
                        ]}
                    />
                </div>
                <label className="flex items-center gap-2 text-caption">
                    <input
                        type="checkbox"
                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                        checked={form.reminder_enabled}
                        onChange={(e) => setForm({ ...form, reminder_enabled: e.target.checked })}
                    />
                    {t('school.study.reminderEnabled')}
                </label>
                <Textarea
                    label={t('school.study.notes')}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4 md:px-6">
                <Button variant="secondary" onClick={onClose}>
                    {t('school.common.cancel')}
                </Button>
                <Button
                    onClick={submit}
                    disabled={!form.title.trim() || createMut.isPending || updateMut.isPending}
                >
                    {t('school.common.save')}
                </Button>
            </div>
        </Dialog>
    );
};

const PlannerDialog: React.FC<{ open: boolean; studentId: string; onClose: () => void }> = ({
    open,
    studentId,
    onClose,
}) => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const subjectOptions = useSubjectOptions();
    const planMut = useGenerateStudyPlan();
    const [error, setError] = useState('');
    const [start, setStart] = useState(todayKey());
    const [weeks, setWeeks] = useState('8');
    const [skipBreaks, setSkipBreaks] = useState(true);
    const [slots, setSlots] = useState<StudyPlanSlot[]>([
        { weekday: 1, subject: 'Mathématique', duration_minutes: 30, start_time: '17:00' },
        { weekday: 3, subject: 'Français', duration_minutes: 30, start_time: '17:00' },
    ]);

    useEffect(() => {
        if (open) setError('');
    }, [open]);

    const updateSlot = (index: number, patch: Partial<StudyPlanSlot>) =>
        setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

    const generate = async () => {
        setError('');
        if (slots.length === 0) {
            setError(t('school.study.plannerNoSlots'));
            return;
        }
        try {
            const result = await planMut.mutateAsync({
                student_id: studentId,
                start_date: start,
                weeks: Math.min(52, Math.max(1, Number(weeks) || 1)),
                skip_breaks: skipBreaks,
                slots: slots.map((s) => ({
                    ...s,
                    title: s.title?.trim() || undefined,
                    start_time: s.start_time || null,
                })),
            });
            showToast({ title: t('school.study.plannerResult', { count: result.created }) });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('school.common.genericError'));
        }
    };

    const weekdayOptions = WEEKDAY_VALUES.map((value, i) => ({
        value: String(value),
        label: t(`calendar.week_days.${WEEK_DAY_KEYS[i]}`),
    }));

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => !next && onClose()}
            title={t('school.study.plannerTitle')}
            description={t('school.study.plannerHint')}
            className="sm:max-w-2xl"
        >
            <div className="space-y-4 px-5 py-4 md:px-6">
                {error && <ErrorBanner message={error} />}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <DatePicker
                        label={t('school.study.plannerStart')}
                        value={start}
                        onChange={setStart}
                    />
                    <Input
                        label={t('school.study.plannerWeeks')}
                        type="number"
                        min={1}
                        max={52}
                        value={weeks}
                        onChange={(e) => setWeeks(e.target.value)}
                    />
                </div>
                <label className="flex items-center gap-2 text-caption">
                    <input
                        type="checkbox"
                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                        checked={skipBreaks}
                        onChange={(e) => setSkipBreaks(e.target.checked)}
                    />
                    {t('school.study.plannerSkipBreaks')}
                </label>

                <div>
                    <SectionTitle
                        action={
                            <Button
                                variant="secondary"
                                onClick={() =>
                                    setSlots((prev) => [
                                        ...prev,
                                        {
                                            weekday: 2,
                                            subject: 'Lecture',
                                            duration_minutes: 20,
                                            start_time: '17:00',
                                        },
                                    ])
                                }
                                disabled={slots.length >= 21}
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                {t('school.study.plannerAddSlot')}
                            </Button>
                        }
                    >
                        {t('school.study.plannerSlots')}
                    </SectionTitle>
                    <div className="space-y-2">
                        {slots.map((slot, index) => (
                            <div
                                key={index}
                                className="grid grid-cols-2 items-end gap-2 rounded-input border border-border p-2 sm:grid-cols-5"
                            >
                                <div>
                                    <label className="mb-1 block text-micro text-muted-foreground">
                                        {t('school.study.weekday')}
                                    </label>
                                    <Select
                                        value={String(slot.weekday)}
                                        onValueChange={(v) =>
                                            updateSlot(index, { weekday: Number(v) })
                                        }
                                        options={weekdayOptions}
                                    />
                                </div>
                                <div className="col-span-2 sm:col-span-2">
                                    <label className="mb-1 block text-micro text-muted-foreground">
                                        {t('school.study.subject')}
                                    </label>
                                    <Select
                                        value={slot.subject}
                                        onValueChange={(v) =>
                                            updateSlot(index, { subject: v as SchoolSubject })
                                        }
                                        options={subjectOptions}
                                    />
                                </div>
                                <Input
                                    label={t('school.study.time')}
                                    type="time"
                                    value={slot.start_time ?? ''}
                                    onChange={(e) =>
                                        updateSlot(index, { start_time: e.target.value })
                                    }
                                />
                                <div className="flex items-end gap-1">
                                    <Input
                                        label={t('school.study.duration')}
                                        type="number"
                                        min={5}
                                        max={480}
                                        value={String(slot.duration_minutes ?? 30)}
                                        onChange={(e) =>
                                            updateSlot(index, {
                                                duration_minutes: Number(e.target.value) || 30,
                                            })
                                        }
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t('school.common.delete')}
                                        className="text-destructive"
                                        onClick={() =>
                                            setSlots((prev) => prev.filter((_, i) => i !== index))
                                        }
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4 md:px-6">
                <Button variant="secondary" onClick={onClose}>
                    {t('school.common.cancel')}
                </Button>
                <Button onClick={generate} disabled={planMut.isPending}>
                    {planMut.isPending
                        ? t('school.study.plannerGenerating')
                        : t('school.study.plannerGenerate')}
                </Button>
            </div>
        </Dialog>
    );
};

// ---------------------------------------------------------------------------
// Results tab
// ---------------------------------------------------------------------------

const ResultsTab: React.FC<{ student: SchoolStudent }> = ({ student }) => {
    const { t } = useTranslation();
    const gradesQuery = useSchoolGrades({ student_id: student.id });
    const statsQuery = useSchoolStatistics(student.id);
    const deleteMut = useDeleteSchoolGrade();
    const [dialogOpen, setDialogOpen] = useState(false);

    const grades = gradesQuery.data ?? [];
    const bySubject = (statsQuery.data?.by_subject ?? []).filter(
        (s) => s.grades_count > 0 || s.sessions_done > 0,
    );

    const remove = async (grade: SchoolGrade) => {
        if (!window.confirm(t('school.results.deleteConfirm'))) return;
        await deleteMut.mutateAsync(grade.id).catch(() => undefined);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-end">
                <Button onClick={() => setDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t('school.results.add')}
                </Button>
            </div>

            {gradesQuery.isError && <ErrorBanner message={t('school.common.error')} />}

            {bySubject.length > 0 && (
                <section>
                    <SectionTitle>{t('school.results.bySubject')}</SectionTitle>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {bySubject.map((s) => (
                            <Card hover={false} key={s.subject}>
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-caption font-medium">
                                            {t(`school.subjects.${s.subject}`)}
                                        </span>
                                        <span className="text-h2 font-semibold">
                                            {s.avg_percentage !== null
                                                ? `${s.avg_percentage}%`
                                                : '—'}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-micro text-muted-foreground">
                                        {t('school.results.gradesCount', { count: s.grades_count })}
                                        {s.last_evaluated_on
                                            ? ` · ${t('school.results.lastEval', {
                                                  date: formatDayMonth(s.last_evaluated_on),
                                              })}`
                                            : ''}
                                    </p>
                                    <p className="mt-1 flex items-center gap-1 text-micro text-muted-foreground">
                                        <TrendingUp className="h-3 w-3" />
                                        {t('school.results.studyTime')} : {s.minutes_done}{' '}
                                        {t('school.common.minutes')}
                                        {s.avg_mastery !== null
                                            ? ` · ${t('school.results.masteryAvg')} ${s.avg_mastery}/5`
                                            : ''}
                                    </p>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </section>
            )}

            {grades.length === 0 ? (
                <EmptyState
                    icon={<TrendingUp className="h-8 w-8" />}
                    title={t('school.results.empty')}
                    description={t('school.results.emptyHint')}
                    actionLabel={t('school.results.add')}
                    onAction={() => setDialogOpen(true)}
                />
            ) : (
                <div className="space-y-2">
                    {grades.map((g) => (
                        <Card hover={false} key={g.id}>
                            <CardContent className="flex items-center justify-between gap-3 p-4">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="truncate text-caption font-medium">
                                            {g.title}
                                        </span>
                                        <Badge variant="primary">
                                            {t(`school.subjects.${g.subject}`)}
                                        </Badge>
                                        {g.term && <Badge variant="secondary">{g.term}</Badge>}
                                    </div>
                                    <p className="mt-1 text-micro text-muted-foreground">
                                        {formatDate(g.evaluated_on)}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`text-body font-semibold ${
                                            g.percentage < 60
                                                ? 'text-danger'
                                                : g.percentage < 75
                                                  ? 'text-warning'
                                                  : 'text-success'
                                        }`}
                                    >
                                        {g.score}/{g.max_score}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t('school.common.delete')}
                                        className="text-destructive"
                                        onClick={() => remove(g)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <GradeDialog
                open={dialogOpen}
                studentId={student.id}
                onClose={() => setDialogOpen(false)}
            />
        </div>
    );
};

const GradeDialog: React.FC<{ open: boolean; studentId: string; onClose: () => void }> = ({
    open,
    studentId,
    onClose,
}) => {
    const { t } = useTranslation();
    const subjectOptions = useSubjectOptions();
    const createMut = useCreateSchoolGrade();
    const [error, setError] = useState('');
    const [form, setForm] = useState({
        subject: 'Mathématique' as SchoolSubject,
        title: '',
        evaluated_on: todayKey(),
        score: '',
        max_score: '100',
        term: '',
        notes: '',
    });

    useEffect(() => {
        if (!open) return;
        setError('');
        setForm({
            subject: 'Mathématique',
            title: '',
            evaluated_on: todayKey(),
            score: '',
            max_score: '100',
            term: '',
            notes: '',
        });
    }, [open]);

    const submit = async () => {
        setError('');
        const score = Number(form.score);
        const maxScore = Number(form.max_score);
        if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
            setError(t('school.common.genericError'));
            return;
        }
        try {
            await createMut.mutateAsync({
                student_id: studentId,
                subject: form.subject,
                title: form.title.trim(),
                evaluated_on: form.evaluated_on,
                score,
                max_score: maxScore,
                term: form.term.trim() || null,
                notes: form.notes.trim() || null,
            });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('school.common.genericError'));
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => !next && onClose()}
            title={t('school.results.add')}
        >
            <div className="space-y-4 px-5 py-4 md:px-6">
                {error && <ErrorBanner message={error} />}
                <div>
                    <label className="mb-1.5 block text-caption font-medium text-foreground">
                        {t('school.results.subject')}
                    </label>
                    <Select
                        value={form.subject}
                        onValueChange={(v) => setForm({ ...form, subject: v as SchoolSubject })}
                        options={subjectOptions}
                    />
                </div>
                <Input
                    label={t('school.results.evalTitle')}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <DatePicker
                        label={t('school.results.date')}
                        value={form.evaluated_on}
                        onChange={(v) => setForm({ ...form, evaluated_on: v })}
                    />
                    <Input
                        label={t('school.results.score')}
                        type="number"
                        min={0}
                        step="0.01"
                        value={form.score}
                        onChange={(e) => setForm({ ...form, score: e.target.value })}
                    />
                    <Input
                        label={t('school.results.maxScore')}
                        type="number"
                        min={1}
                        step="0.01"
                        value={form.max_score}
                        onChange={(e) => setForm({ ...form, max_score: e.target.value })}
                    />
                </div>
                <Input
                    label={t('school.results.term')}
                    placeholder={t('school.results.termPlaceholder')}
                    value={form.term}
                    onChange={(e) => setForm({ ...form, term: e.target.value })}
                />
                <Textarea
                    label={t('school.results.notes')}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4 md:px-6">
                <Button variant="secondary" onClick={onClose}>
                    {t('school.common.cancel')}
                </Button>
                <Button
                    onClick={submit}
                    disabled={!form.title.trim() || !form.score || createMut.isPending}
                >
                    {t('school.common.save')}
                </Button>
            </div>
        </Dialog>
    );
};

export default School;
