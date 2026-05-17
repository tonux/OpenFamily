import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Plus,
    MapPin,
    Calendar as CalendarIcon,
    Edit2,
    Trash2,
    ChevronLeft,
    ExternalLink,
    Star,
    Plane,
    Briefcase,
    Check,
    UserCircle2,
    Users as UsersIcon,
} from 'lucide-react';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Button,
    Dialog,
    Input,
    Select,
    Textarea,
    Badge,
    Tabs,
} from '../components/ui';
import { api } from '../lib/api';
import { useCurrency } from '../lib/useCurrency';
import { cn } from '../lib/utils';

type VacationStatus = 'planning' | 'upcoming' | 'ongoing' | 'past' | 'cancelled';
type AccommodationType = 'airbnb' | 'chalet' | 'hotel' | 'camping' | 'family' | 'other';
type LuggageCategory =
    | 'clothing'
    | 'toiletries'
    | 'documents'
    | 'health'
    | 'electronics'
    | 'kids'
    | 'misc';

interface FamilyMember {
    id: string;
    name: string;
    color: string;
}

interface LuggageItem {
    id: string;
    family_member_id: string | null;
    family_member_name?: string;
    family_member_color?: string;
    category: LuggageCategory;
    item: string;
    quantity: number;
    packed: boolean;
    notes?: string;
}

interface Vacation {
    id: string;
    title: string;
    destination: string;
    country?: string;
    start_date: string;
    end_date: string;
    status: VacationStatus;
    accommodation_type?: AccommodationType;
    accommodation_name?: string;
    accommodation_url?: string;
    accommodation_address?: string;
    accommodation_contact?: string;
    budget_planned?: number;
    actual_cost?: number;
    objectives: string[];
    notes?: string;
    rating?: number;
    review_text?: string;
    participants?: FamilyMember[];
    luggage?: LuggageItem[];
}

const ACCOMMODATION_OPTIONS: Array<{ value: AccommodationType | ''; labelKey: string }> = [
    { value: '', labelKey: 'vacations.accommodation.unspecified' },
    { value: 'airbnb', labelKey: 'vacations.accommodation.airbnb' },
    { value: 'chalet', labelKey: 'vacations.accommodation.chalet' },
    { value: 'hotel', labelKey: 'vacations.accommodation.hotel' },
    { value: 'camping', labelKey: 'vacations.accommodation.camping' },
    { value: 'family', labelKey: 'vacations.accommodation.family' },
    { value: 'other', labelKey: 'vacations.accommodation.other' },
];

const LUGGAGE_CATEGORY_KEYS: Record<LuggageCategory, string> = {
    clothing: 'vacations.luggage.cat.clothing',
    toiletries: 'vacations.luggage.cat.toiletries',
    documents: 'vacations.luggage.cat.documents',
    health: 'vacations.luggage.cat.health',
    electronics: 'vacations.luggage.cat.electronics',
    kids: 'vacations.luggage.cat.kids',
    misc: 'vacations.luggage.cat.misc',
};

const STATUS_COLORS: Record<VacationStatus, string> = {
    planning: 'bg-muted text-muted-foreground',
    upcoming: 'bg-primary-soft text-primary',
    ongoing: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200',
    past: 'bg-surface-2 text-muted-foreground',
    cancelled: 'bg-destructive/10 text-destructive',
};

const formatDateRange = (start: string, end: string, lang: string): string => {
    const s = new Date(start);
    const e = new Date(end);
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
    return `${s.toLocaleDateString(lang, opts)} → ${e.toLocaleDateString(lang, opts)}`;
};

const daysBetween = (start: string, end: string): number => {
    const s = new Date(start);
    const e = new Date(end);
    return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
};

interface VacationFormState {
    title: string;
    destination: string;
    country: string;
    start_date: string;
    end_date: string;
    accommodation_type: AccommodationType | '';
    accommodation_name: string;
    accommodation_url: string;
    accommodation_address: string;
    accommodation_contact: string;
    budget_planned: string;
    objectives: string;
    notes: string;
    participantIds: string[];
}

const emptyForm = (): VacationFormState => ({
    title: '',
    destination: '',
    country: '',
    start_date: '',
    end_date: '',
    accommodation_type: '',
    accommodation_name: '',
    accommodation_url: '',
    accommodation_address: '',
    accommodation_contact: '',
    budget_planned: '',
    objectives: '',
    notes: '',
    participantIds: [],
});

const Vacations: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { format: formatMoney } = useCurrency();
    const [vacations, setVacations] = useState<Vacation[]>([]);
    const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Vacation | null>(null);
    const [form, setForm] = useState<VacationFormState>(emptyForm());
    const [detail, setDetail] = useState<Vacation | null>(null);

    const loadAll = async () => {
        setLoading(true);
        try {
            const [vacRes, famRes] = await Promise.all([
                api.get<{ success: boolean; data: Vacation[] }>('/api/vacations'),
                api.get<{ success: boolean; data: FamilyMember[] }>('/api/family'),
            ]);
            if (vacRes.success) setVacations(vacRes.data);
            if (famRes.success) setFamilyMembers(famRes.data);
        } catch {
            // Ignore — UI shows empty state.
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAll();
    }, []);

    const upcomingList = useMemo(
        () => vacations.filter((v) => v.status === 'planning' || v.status === 'upcoming'),
        [vacations],
    );
    const ongoingList = useMemo(() => vacations.filter((v) => v.status === 'ongoing'), [vacations]);
    const pastList = useMemo(
        () => vacations.filter((v) => v.status === 'past' || v.status === 'cancelled'),
        [vacations],
    );

    const openCreate = () => {
        setEditing(null);
        setForm(emptyForm());
        setDialogOpen(true);
    };

    const openEdit = (v: Vacation) => {
        setEditing(v);
        setForm({
            title: v.title,
            destination: v.destination,
            country: v.country ?? '',
            start_date: v.start_date.slice(0, 10),
            end_date: v.end_date.slice(0, 10),
            accommodation_type: v.accommodation_type ?? '',
            accommodation_name: v.accommodation_name ?? '',
            accommodation_url: v.accommodation_url ?? '',
            accommodation_address: v.accommodation_address ?? '',
            accommodation_contact: v.accommodation_contact ?? '',
            budget_planned:
                v.budget_planned === undefined || v.budget_planned === null
                    ? ''
                    : String(v.budget_planned),
            objectives: (v.objectives ?? []).join(', '),
            notes: v.notes ?? '',
            participantIds: (v.participants ?? []).map((p) => p.id),
        });
        setDialogOpen(true);
    };

    const submit = async () => {
        if (!form.title.trim() || !form.destination.trim() || !form.start_date || !form.end_date) {
            return;
        }
        const payload = {
            title: form.title.trim(),
            destination: form.destination.trim(),
            country: form.country.trim() || null,
            start_date: form.start_date,
            end_date: form.end_date,
            accommodation_type: form.accommodation_type || null,
            accommodation_name: form.accommodation_name.trim() || null,
            accommodation_url: form.accommodation_url.trim() || null,
            accommodation_address: form.accommodation_address.trim() || null,
            accommodation_contact: form.accommodation_contact.trim() || null,
            budget_planned: form.budget_planned.trim() === '' ? null : Number(form.budget_planned),
            objectives: form.objectives
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean),
            notes: form.notes.trim() || null,
            participants: form.participantIds,
        };

        try {
            if (editing) {
                const res = await api.put<{ success: boolean; data: Vacation }>(
                    `/api/vacations/${editing.id}`,
                    payload,
                );
                if (res.success) {
                    // Replace participants too
                    await api.put(`/api/vacations/${editing.id}/participants`, {
                        family_member_ids: form.participantIds,
                    });
                }
            } else {
                await api.post<{ success: boolean; data: Vacation }>('/api/vacations', payload);
            }
            setDialogOpen(false);
            setEditing(null);
            await loadAll();
        } catch {
            // No-op: dialog stays open so user can retry.
        }
    };

    const remove = async (id: string) => {
        if (!window.confirm(t('vacations.confirm_delete'))) return;
        try {
            await api.delete(`/api/vacations/${id}`);
            await loadAll();
        } catch {
            // ignore
        }
    };

    const openDetail = async (id: string) => {
        try {
            const res = await api.get<{ success: boolean; data: Vacation }>(`/api/vacations/${id}`);
            if (res.success) setDetail(res.data);
        } catch {
            // ignore
        }
    };

    if (detail) {
        return (
            <VacationDetail
                vacation={detail}
                familyMembers={familyMembers}
                onBack={() => setDetail(null)}
                onReload={async () => {
                    const res = await api.get<{ success: boolean; data: Vacation }>(
                        `/api/vacations/${detail.id}`,
                    );
                    if (res.success) setDetail(res.data);
                    await loadAll();
                }}
            />
        );
    }

    const renderList = (items: Vacation[], variant: 'upcoming' | 'ongoing' | 'past') => {
        if (loading) {
            return (
                <div className="rounded-card border border-border bg-card p-8 text-center text-caption text-muted-foreground">
                    {t('common.loading')}
                </div>
            );
        }
        if (items.length === 0) {
            return (
                <div className="rounded-card border border-dashed border-border bg-card p-8 text-center">
                    <Plane className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                    <p className="text-caption text-muted-foreground">{t('vacations.empty')}</p>
                </div>
            );
        }
        return (
            <div className="grid gap-3 md:grid-cols-2">
                {items.map((v) => (
                    <Card
                        key={v.id}
                        className="cursor-pointer transition-shadow hover:shadow-surface-hover"
                    >
                        <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-3">
                                <button
                                    type="button"
                                    onClick={() => openDetail(v.id)}
                                    className="flex-1 text-left"
                                >
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-body font-semibold text-foreground">
                                            {v.title}
                                        </h3>
                                        <Badge
                                            className={cn('text-micro', STATUS_COLORS[v.status])}
                                        >
                                            {t(`vacations.status.${v.status}`)}
                                        </Badge>
                                    </div>
                                    <p className="mt-1 flex items-center gap-1 text-caption text-muted-foreground">
                                        <MapPin className="h-3.5 w-3.5" />
                                        {v.destination}
                                        {v.country ? `, ${v.country}` : ''}
                                    </p>
                                    <p className="mt-1 flex items-center gap-1 text-caption text-muted-foreground">
                                        <CalendarIcon className="h-3.5 w-3.5" />
                                        {formatDateRange(v.start_date, v.end_date, i18n.language)}
                                        <span className="ml-1">
                                            ({daysBetween(v.start_date, v.end_date)}{' '}
                                            {t('vacations.days')})
                                        </span>
                                    </p>
                                    {v.participants && v.participants.length > 0 && (
                                        <div className="mt-2 flex -space-x-2">
                                            {v.participants.slice(0, 6).map((p) => (
                                                <span
                                                    key={p.id}
                                                    title={p.name}
                                                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-card text-micro font-semibold text-white"
                                                    style={{ backgroundColor: p.color }}
                                                >
                                                    {p.name.charAt(0).toUpperCase()}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {variant === 'past' &&
                                        v.rating !== undefined &&
                                        v.rating !== null && (
                                            <div className="mt-2 flex items-center gap-0.5">
                                                {Array.from({ length: 5 }).map((_, i) => (
                                                    <Star
                                                        key={i}
                                                        className={cn(
                                                            'h-3.5 w-3.5',
                                                            i < (v.rating ?? 0)
                                                                ? 'fill-yellow-400 text-yellow-400'
                                                                : 'text-muted-foreground/30',
                                                        )}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    {v.budget_planned !== undefined &&
                                        v.budget_planned !== null && (
                                            <p className="mt-2 text-caption text-foreground">
                                                {t('vacations.budget')}:{' '}
                                                {formatMoney(v.budget_planned)}
                                                {v.actual_cost !== undefined &&
                                                    v.actual_cost !== null && (
                                                        <span className="ml-2 text-muted-foreground">
                                                            ({t('vacations.actual')}:{' '}
                                                            {formatMoney(v.actual_cost)})
                                                        </span>
                                                    )}
                                            </p>
                                        )}
                                </button>
                                <div className="flex flex-col gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => openEdit(v)}
                                        aria-label={t('common.edit')}
                                    >
                                        <Edit2 className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => remove(v.id)}
                                        aria-label={t('common.delete')}
                                        className="text-destructive hover:bg-destructive/10"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-h1 font-bold text-foreground">{t('vacations.title')}</h1>
                    <p className="mt-1 text-caption text-muted-foreground">
                        {t('vacations.subtitle')}
                    </p>
                </div>
                <Button onClick={openCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t('vacations.add')}
                </Button>
            </div>

            <Tabs
                defaultValue="upcoming"
                tabs={[
                    {
                        value: 'upcoming',
                        label: t('vacations.tabs.upcoming'),
                        content: <div className="mt-4">{renderList(upcomingList, 'upcoming')}</div>,
                    },
                    {
                        value: 'ongoing',
                        label: t('vacations.tabs.ongoing'),
                        content: <div className="mt-4">{renderList(ongoingList, 'ongoing')}</div>,
                    },
                    {
                        value: 'past',
                        label: t('vacations.tabs.past'),
                        content: <div className="mt-4">{renderList(pastList, 'past')}</div>,
                    },
                ]}
            />

            <Dialog
                open={dialogOpen}
                onOpenChange={(open) => {
                    setDialogOpen(open);
                    if (!open) setEditing(null);
                }}
                title={editing ? t('vacations.edit_title') : t('vacations.add_title')}
            >
                <div className="space-y-3 p-5 md:p-6">
                    <Input
                        placeholder={t('vacations.form.title')}
                        value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                    />
                    <div className="grid gap-3 md:grid-cols-2">
                        <Input
                            placeholder={t('vacations.form.destination')}
                            value={form.destination}
                            onChange={(e) => setForm({ ...form, destination: e.target.value })}
                        />
                        <Input
                            placeholder={t('vacations.form.country')}
                            value={form.country}
                            onChange={(e) => setForm({ ...form, country: e.target.value })}
                        />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                        <Input
                            type="date"
                            value={form.start_date}
                            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                        />
                        <Input
                            type="date"
                            value={form.end_date}
                            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                        />
                    </div>
                    <Select
                        value={form.accommodation_type}
                        onValueChange={(v) =>
                            setForm({ ...form, accommodation_type: v as AccommodationType | '' })
                        }
                        options={ACCOMMODATION_OPTIONS.map((o) => ({
                            value: o.value,
                            label: t(o.labelKey),
                        }))}
                    />
                    <Input
                        placeholder={t('vacations.form.accommodation_name')}
                        value={form.accommodation_name}
                        onChange={(e) => setForm({ ...form, accommodation_name: e.target.value })}
                    />
                    <Input
                        placeholder={t('vacations.form.accommodation_url')}
                        value={form.accommodation_url}
                        onChange={(e) => setForm({ ...form, accommodation_url: e.target.value })}
                    />
                    <Input
                        placeholder={t('vacations.form.accommodation_address')}
                        value={form.accommodation_address}
                        onChange={(e) =>
                            setForm({ ...form, accommodation_address: e.target.value })
                        }
                    />
                    <Input
                        placeholder={t('vacations.form.accommodation_contact')}
                        value={form.accommodation_contact}
                        onChange={(e) =>
                            setForm({ ...form, accommodation_contact: e.target.value })
                        }
                    />
                    <Input
                        type="number"
                        placeholder={t('vacations.form.budget_planned')}
                        value={form.budget_planned}
                        onChange={(e) => setForm({ ...form, budget_planned: e.target.value })}
                    />
                    <Input
                        placeholder={t('vacations.form.objectives_placeholder')}
                        value={form.objectives}
                        onChange={(e) => setForm({ ...form, objectives: e.target.value })}
                    />
                    <Textarea
                        placeholder={t('vacations.form.notes')}
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />

                    <div>
                        <p className="mb-2 flex items-center gap-1 text-caption font-medium text-foreground">
                            <UsersIcon className="h-4 w-4" />
                            {t('vacations.form.participants')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {familyMembers.map((m) => {
                                const selected = form.participantIds.includes(m.id);
                                return (
                                    <button
                                        type="button"
                                        key={m.id}
                                        onClick={() =>
                                            setForm({
                                                ...form,
                                                participantIds: selected
                                                    ? form.participantIds.filter(
                                                          (id) => id !== m.id,
                                                      )
                                                    : [...form.participantIds, m.id],
                                            })
                                        }
                                        className={cn(
                                            'flex items-center gap-2 rounded-pill border px-3 py-1.5 text-caption transition-colors',
                                            selected
                                                ? 'border-primary bg-primary-soft text-primary'
                                                : 'border-border text-muted-foreground hover:bg-surface-2',
                                        )}
                                    >
                                        <span
                                            className="h-2 w-2 rounded-full"
                                            style={{ backgroundColor: m.color }}
                                        />
                                        {m.name}
                                        {selected && <Check className="h-3.5 w-3.5" />}
                                    </button>
                                );
                            })}
                            {familyMembers.length === 0 && (
                                <p className="text-caption text-muted-foreground">
                                    {t('vacations.form.no_family_members')}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button onClick={submit}>{t('common.save')}</Button>
                    </div>
                </div>
            </Dialog>
        </div>
    );
};

// ---------- Detail view ----------

interface DetailProps {
    vacation: Vacation;
    familyMembers: FamilyMember[];
    onBack: () => void;
    onReload: () => Promise<void>;
}

const VacationDetail: React.FC<DetailProps> = ({ vacation, familyMembers, onBack, onReload }) => {
    const { t, i18n } = useTranslation();
    const { format: formatMoney } = useCurrency();

    const [newItem, setNewItem] = useState('');
    const [newItemCat, setNewItemCat] = useState<LuggageCategory>('clothing');
    const [newItemMember, setNewItemMember] = useState<string>('');

    const [reviewOpen, setReviewOpen] = useState(false);
    const [rating, setRating] = useState<number>(vacation.rating ?? 0);
    const [reviewText, setReviewText] = useState<string>(vacation.review_text ?? '');
    const [actualCost, setActualCost] = useState<string>(
        vacation.actual_cost !== undefined && vacation.actual_cost !== null
            ? String(vacation.actual_cost)
            : '',
    );

    const luggageByMember = useMemo(() => {
        const groups = new Map<string, { name: string; color: string; items: LuggageItem[] }>();
        groups.set('__shared__', {
            name: t('vacations.luggage.shared'),
            color: '#94a3b8',
            items: [],
        });
        for (const item of vacation.luggage ?? []) {
            const key = item.family_member_id ?? '__shared__';
            if (!groups.has(key)) {
                groups.set(key, {
                    name: item.family_member_name ?? key,
                    color: item.family_member_color ?? '#94a3b8',
                    items: [],
                });
            }
            groups.get(key)!.items.push(item);
        }
        return Array.from(groups.entries()).filter(
            ([_, g]) => g.items.length > 0 || _ === '__shared__',
        );
    }, [vacation.luggage, t]);

    const addLuggageItem = async () => {
        if (!newItem.trim()) return;
        try {
            await api.post(`/api/vacations/${vacation.id}/luggage`, {
                family_member_id: newItemMember || null,
                category: newItemCat,
                item: newItem.trim(),
                quantity: 1,
            });
            setNewItem('');
            await onReload();
        } catch {
            // ignore
        }
    };

    const toggleItem = async (item: LuggageItem) => {
        try {
            await api.patch(`/api/vacations/${vacation.id}/luggage/${item.id}`, {
                packed: !item.packed,
            });
            await onReload();
        } catch {
            // ignore
        }
    };

    const removeItem = async (id: string) => {
        try {
            await api.delete(`/api/vacations/${vacation.id}/luggage/${id}`);
            await onReload();
        } catch {
            // ignore
        }
    };

    const saveReview = async () => {
        try {
            await api.put(`/api/vacations/${vacation.id}`, {
                rating: rating > 0 ? rating : null,
                review_text: reviewText.trim() || null,
                actual_cost: actualCost.trim() === '' ? null : Number(actualCost),
                status: vacation.status === 'planning' ? 'past' : vacation.status,
            });
            setReviewOpen(false);
            await onReload();
        } catch {
            // ignore
        }
    };

    const packedCount = (vacation.luggage ?? []).filter((i) => i.packed).length;
    const totalCount = (vacation.luggage ?? []).length;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Button variant="ghost" onClick={onBack}>
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    {t('common.back')}
                </Button>
                <Badge className={cn('text-caption', STATUS_COLORS[vacation.status])}>
                    {t(`vacations.status.${vacation.status}`)}
                </Badge>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>{vacation.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-caption">
                    <p className="flex items-center gap-1">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        {vacation.destination}
                        {vacation.country ? `, ${vacation.country}` : ''}
                    </p>
                    <p className="flex items-center gap-1">
                        <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                        {formatDateRange(vacation.start_date, vacation.end_date, i18n.language)}
                        <span className="ml-1 text-muted-foreground">
                            ({daysBetween(vacation.start_date, vacation.end_date)}{' '}
                            {t('vacations.days')})
                        </span>
                    </p>
                    {vacation.accommodation_type && (
                        <p>
                            <span className="text-muted-foreground">
                                {t('vacations.accommodation.label')}:
                            </span>{' '}
                            {t(`vacations.accommodation.${vacation.accommodation_type}`)}
                            {vacation.accommodation_name ? ` — ${vacation.accommodation_name}` : ''}
                        </p>
                    )}
                    {vacation.accommodation_url && (
                        <a
                            href={vacation.accommodation_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                            {t('vacations.open_listing')}
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    )}
                    {vacation.accommodation_address && (
                        <p className="text-muted-foreground">{vacation.accommodation_address}</p>
                    )}
                    {vacation.budget_planned !== undefined && vacation.budget_planned !== null && (
                        <p>
                            <span className="text-muted-foreground">{t('vacations.budget')}:</span>{' '}
                            {formatMoney(vacation.budget_planned)}
                            {vacation.actual_cost !== undefined &&
                                vacation.actual_cost !== null && (
                                    <span className="ml-2 text-muted-foreground">
                                        ({t('vacations.actual')}:{' '}
                                        {formatMoney(vacation.actual_cost)})
                                    </span>
                                )}
                        </p>
                    )}
                    {vacation.objectives.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                            {vacation.objectives.map((o, i) => (
                                <Badge key={i} className="bg-primary-soft text-primary">
                                    {o}
                                </Badge>
                            ))}
                        </div>
                    )}
                    {vacation.participants && vacation.participants.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 pt-2">
                            <UsersIcon className="h-4 w-4 text-muted-foreground" />
                            {vacation.participants.map((p) => (
                                <span
                                    key={p.id}
                                    className="inline-flex items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 py-1 text-micro"
                                >
                                    <span
                                        className="h-2 w-2 rounded-full"
                                        style={{ backgroundColor: p.color }}
                                    />
                                    {p.name}
                                </span>
                            ))}
                        </div>
                    )}
                    {vacation.notes && (
                        <p className="border-l-2 border-border pl-3 text-muted-foreground">
                            {vacation.notes}
                        </p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <Briefcase className="h-5 w-5" />
                        {t('vacations.luggage.title')}
                        {totalCount > 0 && (
                            <span className="text-caption text-muted-foreground">
                                {packedCount}/{totalCount}
                            </span>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto]">
                        <Input
                            placeholder={t('vacations.luggage.placeholder')}
                            value={newItem}
                            onChange={(e) => setNewItem(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') addLuggageItem();
                            }}
                        />
                        <Select
                            value={newItemCat}
                            onValueChange={(v) => setNewItemCat(v as LuggageCategory)}
                            options={(Object.keys(LUGGAGE_CATEGORY_KEYS) as LuggageCategory[]).map(
                                (cat) => ({ value: cat, label: t(LUGGAGE_CATEGORY_KEYS[cat]) }),
                            )}
                        />
                        <Select
                            value={newItemMember}
                            onValueChange={setNewItemMember}
                            options={[
                                { value: '', label: t('vacations.luggage.shared') },
                                ...familyMembers.map((m) => ({ value: m.id, label: m.name })),
                            ]}
                        />
                        <Button onClick={addLuggageItem}>
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>

                    {luggageByMember.map(([key, group]) => (
                        <div key={key} className="space-y-2">
                            <div className="flex items-center gap-2 border-b border-border pb-1">
                                {key === '__shared__' ? (
                                    <UsersIcon className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                    <UserCircle2
                                        className="h-4 w-4"
                                        style={{ color: group.color }}
                                    />
                                )}
                                <span className="text-caption font-semibold text-foreground">
                                    {group.name}
                                </span>
                                <span className="text-micro text-muted-foreground">
                                    {group.items.filter((i) => i.packed).length}/
                                    {group.items.length}
                                </span>
                            </div>
                            {group.items.length === 0 ? (
                                <p className="text-caption text-muted-foreground italic">
                                    {t('vacations.luggage.empty')}
                                </p>
                            ) : (
                                <ul className="space-y-1">
                                    {group.items.map((item) => (
                                        <li
                                            key={item.id}
                                            className="flex items-center justify-between rounded-input px-2 py-1.5 hover:bg-surface-2"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => toggleItem(item)}
                                                className="flex flex-1 items-center gap-2 text-left"
                                            >
                                                <span
                                                    className={cn(
                                                        'flex h-5 w-5 items-center justify-center rounded border',
                                                        item.packed
                                                            ? 'border-primary bg-primary text-primary-foreground'
                                                            : 'border-border bg-card',
                                                    )}
                                                >
                                                    {item.packed && <Check className="h-3 w-3" />}
                                                </span>
                                                <span
                                                    className={cn(
                                                        'text-caption',
                                                        item.packed &&
                                                            'text-muted-foreground line-through',
                                                    )}
                                                >
                                                    {item.item}
                                                    {item.quantity > 1 && ` (×${item.quantity})`}
                                                </span>
                                                <Badge className="bg-surface-2 text-muted-foreground text-micro">
                                                    {t(LUGGAGE_CATEGORY_KEYS[item.category])}
                                                </Badge>
                                            </button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => removeItem(item.id)}
                                                aria-label={t('common.delete')}
                                                className="text-destructive hover:bg-destructive/10"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <Star className="h-5 w-5" />
                        {t('vacations.review.title')}
                    </CardTitle>
                    <Button variant="secondary" onClick={() => setReviewOpen(true)}>
                        {vacation.rating ? t('common.edit') : t('vacations.review.add')}
                    </Button>
                </CardHeader>
                <CardContent>
                    {vacation.rating || vacation.review_text ? (
                        <div className="space-y-2">
                            {vacation.rating && (
                                <div className="flex items-center gap-0.5">
                                    {Array.from({ length: 5 }).map((_, i) => (
                                        <Star
                                            key={i}
                                            className={cn(
                                                'h-5 w-5',
                                                i < (vacation.rating ?? 0)
                                                    ? 'fill-yellow-400 text-yellow-400'
                                                    : 'text-muted-foreground/30',
                                            )}
                                        />
                                    ))}
                                </div>
                            )}
                            {vacation.review_text && (
                                <p className="whitespace-pre-wrap text-caption text-foreground">
                                    {vacation.review_text}
                                </p>
                            )}
                        </div>
                    ) : (
                        <p className="text-caption text-muted-foreground italic">
                            {t('vacations.review.empty')}
                        </p>
                    )}
                </CardContent>
            </Card>

            <Dialog
                open={reviewOpen}
                onOpenChange={setReviewOpen}
                title={t('vacations.review.dialog_title')}
            >
                <div className="space-y-3 p-5 md:p-6">
                    <div>
                        <p className="mb-2 text-caption font-medium">
                            {t('vacations.review.rating')}
                        </p>
                        <div className="flex items-center gap-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => setRating(i + 1)}
                                    aria-label={`${i + 1}/5`}
                                >
                                    <Star
                                        className={cn(
                                            'h-7 w-7 transition-colors',
                                            i < rating
                                                ? 'fill-yellow-400 text-yellow-400'
                                                : 'text-muted-foreground/30 hover:text-yellow-400/60',
                                        )}
                                    />
                                </button>
                            ))}
                        </div>
                    </div>
                    <Input
                        type="number"
                        placeholder={t('vacations.review.actual_cost')}
                        value={actualCost}
                        onChange={(e) => setActualCost(e.target.value)}
                    />
                    <Textarea
                        placeholder={t('vacations.review.text_placeholder')}
                        value={reviewText}
                        onChange={(e) => setReviewText(e.target.value)}
                        rows={5}
                    />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="ghost" onClick={() => setReviewOpen(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button onClick={saveReview}>{t('common.save')}</Button>
                    </div>
                </div>
            </Dialog>
        </div>
    );
};

export default Vacations;
