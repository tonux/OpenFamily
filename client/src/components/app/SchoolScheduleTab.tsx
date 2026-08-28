import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CalendarClock, Clock, Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { Button, Card, CardContent, Dialog, Input, Textarea, useToast } from '../ui';
import EmptyState from './EmptyState';
import {
    ALL_WEEK_DAYS,
    SCHOOL_WEEK_DAYS,
    timeToMinutes,
    toClock,
    useDeleteScheduleEntry,
    useSaveSchoolScheduleSlot,
    useSchoolSchedule,
    type ScheduleEntry,
} from '../../hooks/useSchoolSchedule';

// =============================================================================
// SchoolScheduleTab — "Horaire" in the École page.
//
// The weekly grid a school hands out on paper: rows are time slots, columns
// are days. It reads and writes the family planning (schedule_type='school')
// rather than a table of its own, so the same hour cannot say one thing here
// and another in Planning. See useSchoolSchedule.ts for why.
//
// Two deliberate choices in the rendering:
//
//   * rows come from the time ranges that actually exist, not from a fixed
//     hourly ruler — a school day runs 8h23–9h15 and 9h15–10h15, and a ruler
//     would either lie about those boundaries or waste half the screen;
//   * a slot the user gave several days is edited as one thing (the dialog
//     re-opens with every day it covers pre-selected), because that is how it
//     was created and how it reads on the paper original.
// =============================================================================

interface Props {
    student: {
        id: string;
        name: string;
        family_member_id?: string | null;
    };
}

/** A time range that exists on at least one day, e.g. 08:23 → 09:15. */
interface Row {
    key: string;
    start: string;
    end: string;
}

interface SlotForm {
    /** Set when editing an existing entry; the bulk route then moves it instead of duplicating. */
    sourceId: string | null;
    /**
     * Every row that already makes up this slot, one per day.
     *
     * A slot the user thinks of as one thing ("Dîner, lundi au vendredi") is
     * five rows in the database. Without this list the save would report the
     * slot as conflicting with itself, and dropping a day would leave the old
     * row behind under its former title.
     */
    siblings: Array<{ id: string; day: number }>;
    title: string;
    days: number[];
    start: string;
    end: string;
    location: string;
    notes: string;
}

const emptyForm = (): SlotForm => ({
    sourceId: null,
    siblings: [],
    title: '',
    days: [...SCHOOL_WEEK_DAYS],
    start: '08:30',
    end: '09:30',
    location: '',
    notes: '',
});

export const SchoolScheduleTab: React.FC<Props> = ({ student }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const memberId = student.family_member_id || null;

    const { data: entries = [], isLoading } = useSchoolSchedule(memberId);
    const saveSlot = useSaveSchoolScheduleSlot();
    const deleteEntry = useDeleteScheduleEntry();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [form, setForm] = useState<SlotForm>(emptyForm);
    const [formError, setFormError] = useState('');
    // Tracked separately from the message: whether to offer "overwrite" is a
    // fact the server reported, not something to re-derive from wording.
    const [hasConflict, setHasConflict] = useState(false);

    // Saturday and Sunday only earn a column when something is on them —
    // most schedules would otherwise carry two permanently empty columns.
    const days = useMemo(() => {
        const weekend = ALL_WEEK_DAYS.filter(
            (d) => d > 5 && entries.some((e) => e.day_of_week === d),
        );
        return [...SCHOOL_WEEK_DAYS, ...weekend];
    }, [entries]);

    const rows = useMemo<Row[]>(() => {
        const seen = new Map<string, Row>();
        for (const entry of entries) {
            const start = toClock(entry.start_time);
            const end = toClock(entry.end_time);
            const key = `${start}-${end}`;
            if (!seen.has(key)) {
                seen.set(key, { key, start, end });
            }
        }
        return [...seen.values()].sort(
            (a, b) =>
                timeToMinutes(a.start) - timeToMinutes(b.start) ||
                timeToMinutes(a.end) - timeToMinutes(b.end),
        );
    }, [entries]);

    const cellAt = (row: Row, day: number): ScheduleEntry | undefined =>
        entries.find(
            (e) =>
                e.day_of_week === day &&
                toClock(e.start_time) === row.start &&
                toClock(e.end_time) === row.end,
        );

    /**
     * Every row carrying the same title at the same hours — the days the user
     * created in one go. Editing one cell should offer the whole slot, not
     * silently detach Tuesday from a block made for four days at once.
     */
    const siblingsOf = (entry: ScheduleEntry): Array<{ id: string; day: number }> =>
        entries
            .filter(
                (e) =>
                    e.title === entry.title &&
                    e.start_time === entry.start_time &&
                    e.end_time === entry.end_time,
            )
            .map((e) => ({ id: e.id, day: e.day_of_week }))
            .sort((a, b) => a.day - b.day);

    const openCreate = (row?: Row, day?: number) => {
        setFormError('');
        setHasConflict(false);
        setForm({
            ...emptyForm(),
            days: day ? [day] : [...SCHOOL_WEEK_DAYS],
            start: row?.start ?? '08:30',
            end: row?.end ?? '09:30',
        });
        setDialogOpen(true);
    };

    const openEdit = (entry: ScheduleEntry) => {
        const siblings = siblingsOf(entry);
        setFormError('');
        setHasConflict(false);
        setForm({
            sourceId: entry.id,
            siblings,
            title: entry.title,
            days: siblings.map((s) => s.day),
            start: toClock(entry.start_time),
            end: toClock(entry.end_time),
            location: entry.location ?? '',
            notes: entry.notes ?? '',
        });
        setDialogOpen(true);
    };

    const toggleDay = (day: number) =>
        setForm((prev) => ({
            ...prev,
            days: prev.days.includes(day)
                ? prev.days.filter((d) => d !== day)
                : [...prev.days, day].sort((a, b) => a - b),
        }));

    const submit = async (event: React.SyntheticEvent, replaceConflicts = false) => {
        event.preventDefault();
        setFormError('');
        setHasConflict(false);

        if (!memberId) return;
        if (!form.title.trim()) {
            setFormError(t('school.schedule.errors.title'));
            return;
        }
        if (form.days.length === 0) {
            setFormError(t('school.schedule.errors.days'));
            return;
        }
        if (timeToMinutes(form.end) <= timeToMinutes(form.start)) {
            setFormError(t('school.schedule.errors.times'));
            return;
        }

        const payload = {
            family_member_id: memberId,
            title: form.title.trim(),
            day_of_week_list: form.days,
            start_time: form.start,
            end_time: form.end,
            location: form.location.trim() || null,
            notes: form.notes.trim() || null,
            source_entry_id: form.sourceId,
        };
        const siblingIds = new Set(form.siblings.map((s) => s.id));

        try {
            let result = await saveSlot.mutateAsync({
                ...payload,
                replace_conflicts: replaceConflicts,
            });

            // The server writes the days it can and reports the rest rather
            // than failing the whole slot — so a clash is a decision, not an
            // error to swallow. But when every clashing row belongs to THIS
            // slot, the "clash" is the slot meeting its own other days: the
            // user asked to rewrite them, so rewrite them without a prompt
            // they could only answer one way.
            const allOurs =
                result.conflicts.length > 0 &&
                result.conflicts.every((c) => c.conflict_ids.every((id) => siblingIds.has(id)));

            if (allOurs) {
                result = await saveSlot.mutateAsync({ ...payload, replace_conflicts: true });
            }

            if (result.conflicts.length > 0) {
                setHasConflict(true);
                setFormError(
                    t('school.schedule.errors.conflict', {
                        days: result.conflicts
                            .map((c) => t('school.schedule.days.' + c.day_of_week))
                            .join(', '),
                    }),
                );
                return;
            }

            // Days the user unticked keep their old row otherwise — a leftover
            // Friday still showing the previous title. Removed only after the
            // write succeeded, so a rejected save never costs data.
            const dropped = form.siblings.filter((s) => !form.days.includes(s.day));
            for (const sibling of dropped) {
                await deleteEntry.mutateAsync(sibling.id);
            }

            setDialogOpen(false);
            showToast({ title: t('school.schedule.saved') });
        } catch (error) {
            setFormError(error instanceof Error ? error.message : t('school.schedule.errors.save'));
        }
    };

    const remove = async (entry: ScheduleEntry) => {
        if (!confirm(t('school.schedule.confirmDelete', { title: entry.title }))) return;
        try {
            await deleteEntry.mutateAsync(entry.id);
            showToast({ title: t('school.schedule.deleted') });
        } catch {
            showToast({ title: t('school.schedule.errors.delete') });
        }
    };

    // ---------------------------------------------------------------- states

    // The timetable belongs to a person, not to a student record: without the
    // link there is no member whose week this would be.
    if (!memberId) {
        return (
            <EmptyState
                icon={<Users className="h-8 w-8" />}
                title={t('school.schedule.noMemberTitle')}
                description={t('school.schedule.noMemberHint', { name: student.name })}
            />
        );
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('school.schedule.loading')}
            </div>
        );
    }

    // ---------------------------------------------------------------- render

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="flex items-center gap-2 text-caption font-semibold text-foreground">
                        <CalendarClock className="h-4 w-4 text-muted-foreground" />
                        {t('school.schedule.title')}
                    </p>
                    <p className="text-label-sm text-muted-foreground">
                        {t('school.schedule.subtitle')}{' '}
                        <Link
                            to="/planning"
                            className="text-primary underline-offset-2 hover:underline"
                        >
                            {t('school.schedule.openPlanning')}
                        </Link>
                    </p>
                </div>
                <Button onClick={() => openCreate()}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t('school.schedule.addSlot')}
                </Button>
            </div>

            {rows.length === 0 ? (
                <EmptyState
                    icon={<Clock className="h-8 w-8" />}
                    title={t('school.schedule.emptyTitle')}
                    description={t('school.schedule.emptyHint')}
                    actionLabel={t('school.schedule.addSlot')}
                    onAction={() => openCreate()}
                />
            ) : (
                <Card>
                    <CardContent className="p-0">
                        {/* The grid can exceed the viewport on a phone; it
                            scrolls inside its own box so the page never does. */}
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[720px] border-collapse text-left">
                                <thead>
                                    <tr className="border-b border-border">
                                        <th className="w-28 px-3 py-2 text-label font-semibold text-muted-foreground">
                                            {t('school.schedule.hours')}
                                        </th>
                                        {days.map((day) => (
                                            <th
                                                key={day}
                                                className="px-3 py-2 text-label font-semibold text-foreground"
                                            >
                                                {t('school.schedule.days.' + day)}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => (
                                        <tr
                                            key={row.key}
                                            className="border-b border-border last:border-0"
                                        >
                                            <th className="px-3 py-2 align-top text-label font-medium tabular-nums text-muted-foreground">
                                                {row.start}
                                                <br />
                                                {row.end}
                                            </th>
                                            {days.map((day) => {
                                                const entry = cellAt(row, day);
                                                if (!entry) {
                                                    return (
                                                        <td key={day} className="p-1 align-top">
                                                            <button
                                                                type="button"
                                                                onClick={() => openCreate(row, day)}
                                                                aria-label={t(
                                                                    'school.schedule.addHere',
                                                                )}
                                                                className="h-full min-h-[52px] w-full rounded-input border border-dashed border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-surface-2"
                                                            >
                                                                <Plus className="mx-auto h-4 w-4 opacity-0 transition-opacity hover:opacity-60" />
                                                            </button>
                                                        </td>
                                                    );
                                                }
                                                return (
                                                    <td key={day} className="p-1 align-top">
                                                        <div className="group h-full rounded-input bg-primary-soft/60 p-2">
                                                            <p className="text-body-sm font-medium leading-snug text-foreground">
                                                                {entry.title}
                                                            </p>
                                                            {entry.location && (
                                                                <p className="text-micro text-muted-foreground">
                                                                    {entry.location}
                                                                </p>
                                                            )}
                                                            <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openEdit(entry)}
                                                                    aria-label={t('common.edit')}
                                                                    className="rounded p-1 hover:bg-surface-2"
                                                                >
                                                                    <Pencil className="h-3 w-3" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => remove(entry)}
                                                                    aria-label={t('common.delete')}
                                                                    className="rounded p-1 hover:bg-surface-2"
                                                                >
                                                                    <Trash2 className="h-3 w-3 text-destructive" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Dialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                title={
                    form.sourceId
                        ? t('school.schedule.dialog.editTitle')
                        : t('school.schedule.dialog.newTitle')
                }
                description={t('school.schedule.dialog.description')}
            >
                <form onSubmit={(e) => submit(e)} className="space-y-4">
                    {formError ? (
                        <div className="rounded-input border border-danger/30 bg-danger/10 px-3 py-2 text-caption text-danger">
                            {formError}
                        </div>
                    ) : null}

                    <Input
                        label={t('school.schedule.dialog.titleLabel')}
                        value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                        placeholder={t('school.schedule.dialog.titlePlaceholder')}
                        maxLength={255}
                        required
                    />

                    <div>
                        <label className="mb-1.5 block text-label font-medium text-foreground">
                            {t('school.schedule.dialog.daysLabel')}
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {ALL_WEEK_DAYS.map((day) => {
                                const active = form.days.includes(day);
                                return (
                                    <button
                                        key={day}
                                        type="button"
                                        onClick={() => toggleDay(day)}
                                        aria-pressed={active}
                                        className={`rounded-pill border px-3 py-1.5 text-caption transition-colors ${
                                            active
                                                ? 'border-primary/40 bg-primary-soft text-primary'
                                                : 'border-border bg-card text-muted-foreground hover:bg-surface-2'
                                        }`}
                                    >
                                        {t('school.schedule.daysShort.' + day)}
                                    </button>
                                );
                            })}
                        </div>
                        <button
                            type="button"
                            onClick={() => setForm({ ...form, days: [...SCHOOL_WEEK_DAYS] })}
                            className="mt-2 text-label text-primary underline-offset-2 hover:underline"
                        >
                            {t('school.schedule.dialog.selectWeekdays')}
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label={t('school.schedule.dialog.startLabel')}
                            type="time"
                            value={form.start}
                            onChange={(e) => setForm({ ...form, start: e.target.value })}
                            required
                        />
                        <Input
                            label={t('school.schedule.dialog.endLabel')}
                            type="time"
                            value={form.end}
                            onChange={(e) => setForm({ ...form, end: e.target.value })}
                            required
                        />
                    </div>

                    <Input
                        label={t('school.schedule.dialog.locationLabel')}
                        value={form.location}
                        onChange={(e) => setForm({ ...form, location: e.target.value })}
                        placeholder={t('school.schedule.dialog.locationPlaceholder')}
                    />

                    <Textarea
                        label={t('school.schedule.dialog.notesLabel')}
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        rows={2}
                    />

                    <div className="flex flex-wrap justify-end gap-3 pt-2">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setDialogOpen(false)}
                        >
                            {t('common.cancel')}
                        </Button>
                        {/* Offered only once the server actually reported a
                            clash — overwriting is never the default path. */}
                        {hasConflict && (
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={(e) => submit(e, true)}
                                disabled={saveSlot.isPending}
                            >
                                {t('school.schedule.dialog.replace')}
                            </Button>
                        )}
                        <Button type="submit" disabled={saveSlot.isPending}>
                            {saveSlot.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            {t('common.save')}
                        </Button>
                    </div>
                </form>
            </Dialog>
        </div>
    );
};

export default SchoolScheduleTab;
