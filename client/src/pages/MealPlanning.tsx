import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import {
    Plus,
    ChevronLeft,
    ChevronRight,
    Edit2,
    Trash2,
    Sandwich,
    ShoppingBasket,
    Sparkles,
} from 'lucide-react';
import { Card, CardContent, Button, Dialog, Input, Select, Textarea, Tabs } from '../components/ui';
import { NutritionAnalysisDialog } from '../components/app/NutritionAnalysisDialog';
import { LunchboxAiDialog, type LunchboxIdea } from '../components/app/LunchboxAiDialog';
import {
    format,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    addWeeks,
    subWeeks,
    getDay,
    subDays,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { mealTypeGradient } from '../design/colorPresets';

interface FamilyMember {
    id: string;
    name: string;
    color: string;
}

interface LunchboxItems {
    main?: string;
    fruit?: string;
    snack?: string;
    drink?: string;
}

interface MealPlan {
    id: string;
    date: string;
    meal_type: string;
    recipe_id?: string;
    custom_meal?: string;
    notes?: string;
    family_member_id?: string | null;
    lunchbox_items?: LunchboxItems | null;
    recipe?: { id: string; name: string } | null;
    family_member?: { id: string; name: string; color: string } | null;
}

interface Recipe {
    id: string;
    name: string;
    category: string;
}

const LUNCHBOX_TYPE = 'Boîte à lunch';
const HOUSEHOLD_MEAL_TYPES = ['Petit-déjeuner', 'Déjeuner', 'Dîner', 'Snack'] as const;

const DEFAULT_HOUSEHOLD_FORM = {
    meal_type: 'Déjeuner',
    recipe_id: '',
    custom_meal: '',
    notes: '',
};

const DEFAULT_LUNCHBOX_FORM = {
    family_member_id: '',
    main: '',
    fruit: '',
    snack: '',
    drink: '',
    notes: '',
};

const MealPlanning: React.FC = () => {
    const [currentWeek, setCurrentWeek] = useState(new Date());
    const [nutritionDialogOpen, setNutritionDialogOpen] = useState(false);
    const [mealPlans, setMealPlans] = useState<MealPlan[]>([]);
    const [recipes, setRecipes] = useState<Recipe[]>([]);
    const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');

    // Two distinct dialogs: one for the existing household meals, one for
    // structured per-kid lunchboxes. They share the same calendar but the
    // form shapes diverge enough that a single form would be confusing.
    const [householdOpen, setHouseholdOpen] = useState(false);
    const [lunchboxOpen, setLunchboxOpen] = useState(false);
    const [lunchboxAiOpen, setLunchboxAiOpen] = useState(false);
    const [editingMeal, setEditingMeal] = useState<MealPlan | null>(null);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [householdForm, setHouseholdForm] = useState(DEFAULT_HOUSEHOLD_FORM);
    const [lunchboxForm, setLunchboxForm] = useState(DEFAULT_LUNCHBOX_FORM);

    useEffect(() => {
        loadMealPlans();
    }, [currentWeek]);

    useEffect(() => {
        loadRecipes();
        loadFamilyMembers();
    }, []);

    const loadMealPlans = async () => {
        try {
            const start = startOfWeek(currentWeek, { weekStartsOn: 1 });
            const end = endOfWeek(currentWeek, { weekStartsOn: 1 });
            const response = await api.get<{ success: boolean; data: MealPlan[] }>(
                `/api/meal-plans?start_date=${format(start, 'yyyy-MM-dd')}&end_date=${format(end, 'yyyy-MM-dd')}`,
            );
            if (response.success) setMealPlans(response.data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Impossible de charger le planning.');
        } finally {
            setLoading(false);
        }
    };

    const loadRecipes = async () => {
        try {
            const response = await api.get<{ success: boolean; data: Recipe[] }>('/api/recipes');
            if (response.success) setRecipes(response.data);
        } catch (err) {
            // Non-fatal: recipes are optional, the user can still use custom_meal.
            console.warn('Failed to load recipes', err);
        }
    };

    const loadFamilyMembers = async () => {
        try {
            const response = await api.get<{ success: boolean; data: FamilyMember[] }>(
                '/api/family',
            );
            if (response.success) setFamilyMembers(response.data);
        } catch (err) {
            console.warn('Failed to load family members', err);
        }
    };

    // -------- Household meals (existing flow) --------

    const openHouseholdNew = (date: Date, mealType: string) => {
        setEditingMeal(null);
        setSelectedDate(date);
        setHouseholdForm({ ...DEFAULT_HOUSEHOLD_FORM, meal_type: mealType });
        setError('');
        setHouseholdOpen(true);
    };

    const openHouseholdEdit = (meal: MealPlan) => {
        setEditingMeal(meal);
        setSelectedDate(new Date(meal.date + 'T12:00:00'));
        setHouseholdForm({
            meal_type: meal.meal_type,
            recipe_id: meal.recipe_id || '',
            custom_meal: meal.custom_meal || '',
            notes: meal.notes || '',
        });
        setError('');
        setHouseholdOpen(true);
    };

    const handleHouseholdSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedDate) return;
        setError('');
        try {
            const payload = {
                date: format(selectedDate, 'yyyy-MM-dd'),
                meal_type: householdForm.meal_type,
                recipe_id: householdForm.recipe_id || null,
                custom_meal: householdForm.custom_meal || null,
                notes: householdForm.notes || null,
            };
            if (editingMeal) {
                await api.put(`/api/meal-plans/${editingMeal.id}`, payload);
            } else {
                await api.post('/api/meal-plans', payload);
            }
            setHouseholdOpen(false);
            await loadMealPlans();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Impossible d'enregistrer ce repas.");
        }
    };

    // -------- Lunchbox (new flow) --------

    const openLunchboxNew = (date: Date, presetMemberId?: string) => {
        setEditingMeal(null);
        setSelectedDate(date);
        setLunchboxForm({
            ...DEFAULT_LUNCHBOX_FORM,
            family_member_id: presetMemberId || familyMembers[0]?.id || '',
        });
        setError('');
        setLunchboxOpen(true);
    };

    const openLunchboxEdit = (meal: MealPlan) => {
        setEditingMeal(meal);
        setSelectedDate(new Date(meal.date + 'T12:00:00'));
        const items = meal.lunchbox_items || {};
        setLunchboxForm({
            family_member_id: meal.family_member_id || '',
            main: items.main || '',
            fruit: items.fruit || '',
            snack: items.snack || '',
            drink: items.drink || '',
            notes: meal.notes || '',
        });
        setError('');
        setLunchboxOpen(true);
    };

    // Pre-fills the lunchbox form from an AI-generated idea. Reasoning +
    // warnings are appended to notes so the parent keeps them handy when
    // preparing the box.
    const applyLunchboxIdea = (idea: LunchboxIdea) => {
        const noteParts: string[] = [];
        if (lunchboxForm.notes.trim()) noteParts.push(lunchboxForm.notes.trim());
        if (idea.reasoning) noteParts.push(`IA — ${idea.reasoning}`);
        for (const w of idea.warnings) noteParts.push(`⚠️ ${w}`);
        setLunchboxForm((prev) => ({
            ...prev,
            main: idea.main || prev.main,
            fruit: idea.fruit || prev.fruit,
            snack: idea.snack || prev.snack,
            drink: idea.drink || prev.drink,
            notes: noteParts.join('\n'),
        }));
        setLunchboxAiOpen(false);
    };

    const handleLunchboxSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedDate) return;
        if (!lunchboxForm.family_member_id) {
            setError('Sélectionne un enfant.');
            return;
        }
        const lunchbox_items = {
            main: lunchboxForm.main,
            fruit: lunchboxForm.fruit,
            snack: lunchboxForm.snack,
            drink: lunchboxForm.drink,
        };
        if (!Object.values(lunchbox_items).some((v) => v.trim())) {
            setError('Renseigne au moins un élément (plat, fruit, snack ou boisson).');
            return;
        }

        setError('');
        try {
            const payload = {
                date: format(selectedDate, 'yyyy-MM-dd'),
                meal_type: LUNCHBOX_TYPE,
                family_member_id: lunchboxForm.family_member_id,
                lunchbox_items,
                notes: lunchboxForm.notes || null,
            };
            if (editingMeal) {
                await api.put(`/api/meal-plans/${editingMeal.id}`, payload);
            } else {
                await api.post('/api/meal-plans', payload);
            }
            setLunchboxOpen(false);
            await loadMealPlans();
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Impossible d'enregistrer cette boîte à lunch.",
            );
        }
    };

    // -------- Common --------

    const handleDelete = async (id: string) => {
        if (!confirm('Êtes-vous sûr de vouloir supprimer ce repas ?')) return;
        try {
            await api.delete(`/api/meal-plans/${id}`);
            await loadMealPlans();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Impossible de supprimer ce repas.');
        }
    };

    const generateLunchboxShoppingList = async () => {
        const start = startOfWeek(currentWeek, { weekStartsOn: 1 });
        const end = endOfWeek(currentWeek, { weekStartsOn: 1 });
        setError('');
        setInfo('');
        try {
            const response = await api.post<{
                success: boolean;
                data: { inserted: number; total_lunchboxes: number };
            }>('/api/meal-plans/lunchbox/shopping-list', {
                start_date: format(start, 'yyyy-MM-dd'),
                end_date: format(end, 'yyyy-MM-dd'),
            });
            if (response.success) {
                if (response.data.inserted === 0) {
                    setInfo('Aucune boîte à lunch renseignée cette semaine.');
                } else {
                    setInfo(
                        `${response.data.inserted} article(s) ajouté(s) à la liste de courses (${response.data.total_lunchboxes} boîtes traitées).`,
                    );
                }
            }
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Impossible de générer la liste de courses.',
            );
        }
    };

    // -------- Derived data --------

    const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 1 });
    const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
    // School days only (Mon=1 .. Fri=5; date-fns getDay returns 0=Sun..6=Sat).
    const isWeekday = (d: Date) => {
        const dow = getDay(d);
        return dow >= 1 && dow <= 5;
    };

    const getHouseholdMeal = (date: Date, mealType: string) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        return mealPlans.find(
            (m) => m.date === dateStr && m.meal_type === mealType && !m.family_member_id,
        );
    };

    const getLunchboxesForDay = (date: Date): MealPlan[] => {
        const dateStr = format(date, 'yyyy-MM-dd');
        return mealPlans.filter(
            (m) => m.date === dateStr && m.meal_type === LUNCHBOX_TYPE && m.family_member_id,
        );
    };

    // Per-meal-type gradients now sourced from the centralised palette
    // (`MEAL_TYPE_COLORS` in design/colorPresets.ts) and applied via inline
    // style so the values stay in sync with the rest of the design tokens.
    // Tailwind can't generate utility classes from runtime hex values, hence
    // the switch to `style={mealTypeGradient(...)}`.
    const getMealTypeStyle = (mealType: string): React.CSSProperties => mealTypeGradient(mealType);

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center min-h-[50vh]">
                <div className="flex flex-col items-center gap-4">
                    <div className="spinner-brand" />
                    <p className="text-muted-foreground font-medium animate-pulse">
                        Chargement du planning...
                    </p>
                </div>
            </div>
        );
    }

    const planningTab = (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <h2 className="text-h2 font-semibold">
                    Semaine du {format(weekStart, 'dd MMM', { locale: fr })} au{' '}
                    {format(weekEnd, 'dd MMM yyyy', { locale: fr })}
                </h2>
                <div className="flex items-center gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setCurrentWeek(new Date())}
                    >
                        Cette semaine
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
                    >
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button size="sm" onClick={() => setNutritionDialogOpen(true)}>
                        <Sparkles className="w-4 h-4 mr-1.5" />
                        Analyser
                    </Button>
                </div>
            </div>

            <NutritionAnalysisDialog
                open={nutritionDialogOpen}
                onOpenChange={setNutritionDialogOpen}
                weekStart={format(weekStart, 'yyyy-MM-dd')}
                weekEnd={format(weekEnd, 'yyyy-MM-dd')}
            />

            <Card>
                <CardContent className="p-6">
                    {/* Weekly Grid */}
                    <div className="overflow-x-auto">
                        <div className="min-w-[800px]">
                            {/* Header */}
                            <div className="grid grid-cols-8 gap-2 mb-2">
                                <div></div>
                                {weekDays.map((day) => (
                                    <div key={day.toISOString()} className="text-center">
                                        <div className="font-semibold text-body-sm">
                                            {format(day, 'EEE', { locale: fr })}
                                        </div>
                                        <div className="text-label text-muted-foreground">
                                            {format(day, 'dd MMM', { locale: fr })}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Household meal rows */}
                            {HOUSEHOLD_MEAL_TYPES.map((mealType) => (
                                <div key={mealType} className="grid grid-cols-8 gap-2 mb-2">
                                    <div className="flex items-center font-medium text-body-sm text-muted-foreground">
                                        {mealType}
                                    </div>
                                    {weekDays.map((day) => {
                                        const meal = getHouseholdMeal(day, mealType);
                                        return (
                                            <div
                                                key={`${day.toISOString()}-${mealType}`}
                                                className="min-h-[80px] p-2 rounded-lg border cursor-pointer hover:shadow-md transition-all"
                                                style={getMealTypeStyle(mealType)}
                                                onClick={() =>
                                                    meal
                                                        ? openHouseholdEdit(meal)
                                                        : openHouseholdNew(day, mealType)
                                                }
                                            >
                                                {meal ? (
                                                    <div className="space-y-1">
                                                        <div className="font-medium text-body-sm line-clamp-2">
                                                            {meal.recipe?.name || meal.custom_meal}
                                                        </div>
                                                        {meal.notes && (
                                                            <div className="text-[10px] text-muted-foreground line-clamp-1">
                                                                {meal.notes}
                                                            </div>
                                                        )}
                                                        <div className="flex gap-1 mt-2">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    openHouseholdEdit(meal);
                                                                }}
                                                                className="p-1 hover:bg-card/70 rounded"
                                                            >
                                                                <Edit2 className="h-3 w-3" />
                                                            </button>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDelete(meal.id);
                                                                }}
                                                                className="p-1 hover:bg-card/70 rounded"
                                                            >
                                                                <Trash2 className="h-3 w-3 text-destructive" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center justify-center h-full opacity-40">
                                                        <Plus className="h-5 w-5" />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}

                            {/* Lunchbox row — Mon-Fri only */}
                            <div className="grid grid-cols-8 gap-2 mb-2 mt-4 pt-4 border-t border-border">
                                <div className="flex items-center gap-1.5 font-medium text-body-sm text-muted-foreground">
                                    <Sandwich className="h-4 w-4" />
                                    Boîte à lunch
                                </div>
                                {weekDays.map((day) => {
                                    if (!isWeekday(day)) {
                                        return (
                                            <div
                                                key={`lunchbox-${day.toISOString()}`}
                                                className="min-h-[80px] p-2 rounded-lg border border-dashed border-border bg-muted/10 flex items-center justify-center text-[10px] text-muted-foreground"
                                            >
                                                —
                                            </div>
                                        );
                                    }
                                    const lunchboxes = getLunchboxesForDay(day);
                                    return (
                                        <div
                                            key={`lunchbox-${day.toISOString()}`}
                                            className="min-h-[80px] p-2 rounded-lg border transition-all space-y-1"
                                            style={getMealTypeStyle(LUNCHBOX_TYPE)}
                                        >
                                            {lunchboxes.map((lb) => (
                                                <button
                                                    key={lb.id}
                                                    type="button"
                                                    onClick={() => openLunchboxEdit(lb)}
                                                    className="w-full text-left rounded-md bg-card/70 px-1.5 py-1 hover:bg-card transition-colors group"
                                                >
                                                    <div className="flex items-center gap-1.5">
                                                        <span
                                                            className="inline-block h-2 w-2 rounded-full shrink-0"
                                                            style={{
                                                                background:
                                                                    lb.family_member?.color ||
                                                                    '#999',
                                                            }}
                                                        />
                                                        <span className="truncate text-[11px] font-medium">
                                                            {lb.family_member?.name}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDelete(lb.id);
                                                            }}
                                                            className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                                                            aria-label="Supprimer"
                                                        >
                                                            <Trash2 className="h-3 w-3 text-red-500" />
                                                        </button>
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground line-clamp-1">
                                                        {[
                                                            lb.lunchbox_items?.main,
                                                            lb.lunchbox_items?.fruit,
                                                            lb.lunchbox_items?.snack,
                                                            lb.lunchbox_items?.drink,
                                                        ]
                                                            .filter(Boolean)
                                                            .join(' · ')}
                                                    </div>
                                                </button>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => openLunchboxNew(day)}
                                                className="w-full flex items-center justify-center py-1 opacity-50 hover:opacity-100 transition-opacity"
                                                disabled={familyMembers.length === 0}
                                            >
                                                <Plus className="h-4 w-4" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>

                            {familyMembers.length === 0 && (
                                <p className="mt-2 text-micro text-muted-foreground">
                                    Ajoute d'abord des membres de la famille pour pouvoir préparer
                                    des boîtes à lunch.
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-end mt-4">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={generateLunchboxShoppingList}
                        >
                            <ShoppingBasket className="h-4 w-4 mr-2" />
                            Générer la liste de courses (boîtes de la semaine)
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );

    const tabs = [
        { value: 'planning', label: 'Planning', content: planningTab },
        {
            value: 'tracking',
            label: 'Suivi boîtes à lunch',
            content: <LunchboxTracking familyMembers={familyMembers} />,
        },
    ];

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div>
                <h1 className="text-h1 mb-1">Planning des repas</h1>
                <p className="text-muted-foreground text-body">
                    Organisez vos repas et les boîtes à lunch des enfants
                </p>
            </div>

            {error && (
                <div className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-caption text-danger">
                    {error}
                </div>
            )}
            {info && (
                <div className="rounded-input border border-success/40 bg-success-soft px-4 py-3 text-caption text-success">
                    {info}
                </div>
            )}

            <Tabs tabs={tabs} />

            {/* Household meal dialog */}
            <Dialog
                open={householdOpen}
                onOpenChange={setHouseholdOpen}
                title={editingMeal ? 'Modifier le repas' : 'Ajouter un repas'}
                description={
                    selectedDate
                        ? `${householdForm.meal_type} du ${format(selectedDate, 'dd MMMM yyyy', { locale: fr })}`
                        : ''
                }
            >
                <form onSubmit={handleHouseholdSubmit} className="space-y-4">
                    <div>
                        <label className="block text-label font-medium text-foreground mb-1.5">
                            Type de repas
                        </label>
                        <Select
                            value={householdForm.meal_type}
                            onValueChange={(value) =>
                                setHouseholdForm({ ...householdForm, meal_type: value })
                            }
                            options={HOUSEHOLD_MEAL_TYPES.map((type) => ({
                                value: type,
                                label: type,
                            }))}
                        />
                    </div>
                    <div>
                        <label className="block text-label font-medium text-foreground mb-1.5">
                            Recette (optionnel)
                        </label>
                        <Select
                            value={householdForm.recipe_id}
                            onValueChange={(value) =>
                                setHouseholdForm({
                                    ...householdForm,
                                    recipe_id: value,
                                    custom_meal: '',
                                })
                            }
                            options={[
                                { value: '', label: 'Aucune recette' },
                                ...recipes.map((r) => ({
                                    value: r.id,
                                    label: `${r.name} (${r.category})`,
                                })),
                            ]}
                        />
                    </div>
                    {!householdForm.recipe_id && (
                        <Input
                            label="Ou repas personnalisé"
                            value={householdForm.custom_meal}
                            onChange={(e) =>
                                setHouseholdForm({ ...householdForm, custom_meal: e.target.value })
                            }
                            placeholder="Ex: Pizza maison"
                        />
                    )}
                    <Textarea
                        label="Notes (optionnel)"
                        value={householdForm.notes}
                        onChange={(e) =>
                            setHouseholdForm({ ...householdForm, notes: e.target.value })
                        }
                        placeholder="Notes supplémentaires..."
                        rows={2}
                    />
                    <div className="flex justify-end gap-3 pt-4">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setHouseholdOpen(false)}
                        >
                            Annuler
                        </Button>
                        <Button type="submit">{editingMeal ? 'Enregistrer' : 'Ajouter'}</Button>
                    </div>
                </form>
            </Dialog>

            {/* Lunchbox dialog */}
            <Dialog
                open={lunchboxOpen}
                onOpenChange={setLunchboxOpen}
                title={editingMeal ? 'Modifier la boîte à lunch' : 'Préparer une boîte à lunch'}
                description={
                    selectedDate
                        ? `Pour le ${format(selectedDate, 'EEEE dd MMMM yyyy', { locale: fr })}`
                        : ''
                }
            >
                <form onSubmit={handleLunchboxSubmit} className="space-y-4">
                    <div>
                        <label className="block text-label font-medium text-foreground mb-1.5">
                            Enfant
                        </label>
                        <Select
                            value={lunchboxForm.family_member_id}
                            onValueChange={(value) =>
                                setLunchboxForm({ ...lunchboxForm, family_member_id: value })
                            }
                            options={familyMembers.map((m) => ({ value: m.id, label: m.name }))}
                        />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-input border border-dashed border-primary/40 bg-primary/5 px-3 py-2">
                        <p className="text-label-sm text-muted-foreground">
                            Plus d'idée ? Génère une suggestion à partir de ce que tu as à la
                            maison.
                        </p>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setLunchboxAiOpen(true)}
                        >
                            <Sparkles className="w-4 h-4 mr-1.5" />
                            Suggérer
                        </Button>
                    </div>
                    <Input
                        label="Plat principal"
                        value={lunchboxForm.main}
                        onChange={(e) => setLunchboxForm({ ...lunchboxForm, main: e.target.value })}
                        placeholder="Ex: sandwich jambon-fromage"
                    />
                    <Input
                        label="Fruit / légume"
                        value={lunchboxForm.fruit}
                        onChange={(e) =>
                            setLunchboxForm({ ...lunchboxForm, fruit: e.target.value })
                        }
                        placeholder="Ex: clémentine"
                    />
                    <Input
                        label="Snack / collation"
                        value={lunchboxForm.snack}
                        onChange={(e) =>
                            setLunchboxForm({ ...lunchboxForm, snack: e.target.value })
                        }
                        placeholder="Ex: barre de céréales"
                    />
                    <Input
                        label="Boisson"
                        value={lunchboxForm.drink}
                        onChange={(e) =>
                            setLunchboxForm({ ...lunchboxForm, drink: e.target.value })
                        }
                        placeholder="Ex: jus de pomme"
                    />
                    <Textarea
                        label="Notes (optionnel)"
                        value={lunchboxForm.notes}
                        onChange={(e) =>
                            setLunchboxForm({ ...lunchboxForm, notes: e.target.value })
                        }
                        placeholder="Allergie, préférence du jour..."
                        rows={2}
                    />
                    <div className="flex justify-end gap-3 pt-4">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setLunchboxOpen(false)}
                        >
                            Annuler
                        </Button>
                        <Button type="submit">{editingMeal ? 'Enregistrer' : 'Préparer'}</Button>
                    </div>
                </form>
            </Dialog>

            <LunchboxAiDialog
                open={lunchboxAiOpen}
                onOpenChange={setLunchboxAiOpen}
                familyMember={
                    familyMembers.find((m) => m.id === lunchboxForm.family_member_id) ?? null
                }
                onIdeaApplied={applyLunchboxIdea}
            />
        </div>
    );
};

// -------- Tracking sub-component --------

interface TrackingProps {
    familyMembers: FamilyMember[];
}

interface LunchboxStats {
    totalLunchboxes: number;
    byField: Record<'main' | 'fruit' | 'snack' | 'drink', Array<{ label: string; count: number }>>;
}

const FIELD_LABELS: Record<string, string> = {
    main: 'Plat principal',
    fruit: 'Fruit / légume',
    snack: 'Snack',
    drink: 'Boisson',
};

const LunchboxTracking: React.FC<TrackingProps> = ({ familyMembers }) => {
    const [selectedMemberId, setSelectedMemberId] = useState<string>('');
    const [history, setHistory] = useState<MealPlan[]>([]);
    const [stats, setStats] = useState<LunchboxStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (familyMembers.length > 0 && !selectedMemberId) {
            setSelectedMemberId(familyMembers[0].id);
        }
    }, [familyMembers, selectedMemberId]);

    useEffect(() => {
        if (!selectedMemberId) return;
        loadTracking(selectedMemberId);
    }, [selectedMemberId]);

    const loadTracking = async (memberId: string) => {
        setLoading(true);
        setError('');
        try {
            // Stats default: last 60 days. Pin both start and end so the
            // server doesn't drift around midnight.
            const end = new Date();
            const start = subDays(end, 60);
            const startStr = format(start, 'yyyy-MM-dd');
            const endStr = format(end, 'yyyy-MM-dd');

            const [historyResp, statsResp] = await Promise.all([
                api.get<{ success: boolean; data: MealPlan[] }>(
                    `/api/meal-plans/lunchbox/history/${memberId}?limit=30`,
                ),
                api.get<{ success: boolean; data: LunchboxStats }>(
                    `/api/meal-plans/lunchbox/stats/${memberId}?start_date=${startStr}&end_date=${endStr}`,
                ),
            ]);
            if (historyResp.success) setHistory(historyResp.data);
            if (statsResp.success) setStats(statsResp.data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Impossible de charger le suivi.');
        } finally {
            setLoading(false);
        }
    };

    const selectedMember = useMemo(
        () => familyMembers.find((m) => m.id === selectedMemberId),
        [familyMembers, selectedMemberId],
    );

    if (familyMembers.length === 0) {
        return (
            <Card>
                <CardContent className="p-6 text-center text-muted-foreground text-caption">
                    Ajoute d'abord des membres de la famille pour suivre les boîtes à lunch.
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            {/* Member tabs */}
            <div className="flex flex-wrap gap-2">
                {familyMembers.map((m) => (
                    <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedMemberId(m.id)}
                        className={`flex items-center gap-2 rounded-pill px-3 py-1.5 text-caption font-medium border transition-colors ${
                            selectedMemberId === m.id
                                ? 'bg-primary text-white border-primary'
                                : 'bg-card text-foreground border-border hover:bg-surface-2'
                        }`}
                    >
                        <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ background: m.color }}
                        />
                        {m.name}
                    </button>
                ))}
            </div>

            {error && (
                <div className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-caption text-danger">
                    {error}
                </div>
            )}

            {loading && (
                <div className="text-center text-caption text-muted-foreground py-6">
                    Chargement...
                </div>
            )}

            {!loading && selectedMember && (
                <>
                    {/* Stats */}
                    <Card>
                        <CardContent className="p-6">
                            <h3 className="text-h2 font-semibold mb-4">
                                Items les plus fréquents — 60 derniers jours
                            </h3>
                            {stats && stats.totalLunchboxes > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {(['main', 'fruit', 'snack', 'drink'] as const).map((field) => (
                                        <div key={field} className="space-y-2">
                                            <p className="text-caption font-semibold">
                                                {FIELD_LABELS[field]}
                                            </p>
                                            {stats.byField[field].length === 0 ? (
                                                <p className="text-micro text-muted-foreground">
                                                    Rien encore.
                                                </p>
                                            ) : (
                                                <ul className="space-y-1">
                                                    {stats.byField[field].slice(0, 5).map((row) => (
                                                        <li
                                                            key={row.label}
                                                            className="flex items-center justify-between rounded-input bg-surface-2 px-3 py-1.5 text-caption"
                                                        >
                                                            <span className="capitalize">
                                                                {row.label}
                                                            </span>
                                                            <span className="text-muted-foreground text-micro">
                                                                × {row.count}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-caption text-muted-foreground">
                                    Aucune boîte à lunch préparée sur les 60 derniers jours.
                                </p>
                            )}
                            {stats && (
                                <p className="mt-4 text-micro text-muted-foreground">
                                    Total : {stats.totalLunchboxes} boîte(s) sur la période.
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    {/* History */}
                    <Card>
                        <CardContent className="p-6">
                            <h3 className="text-h2 font-semibold mb-4">Historique récent</h3>
                            {history.length === 0 ? (
                                <p className="text-caption text-muted-foreground">
                                    Pas encore d'historique pour {selectedMember.name}.
                                </p>
                            ) : (
                                <ul className="space-y-2">
                                    {history.map((lb) => (
                                        <li
                                            key={lb.id}
                                            className="rounded-card border border-border bg-card p-3"
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="text-caption font-semibold">
                                                    {format(
                                                        new Date(lb.date + 'T12:00:00'),
                                                        'EEEE dd MMM yyyy',
                                                        {
                                                            locale: fr,
                                                        },
                                                    )}
                                                </span>
                                            </div>
                                            <div className="mt-1 text-micro text-muted-foreground">
                                                {[
                                                    lb.lunchbox_items?.main,
                                                    lb.lunchbox_items?.fruit,
                                                    lb.lunchbox_items?.snack,
                                                    lb.lunchbox_items?.drink,
                                                ]
                                                    .filter(Boolean)
                                                    .join(' · ') || '—'}
                                            </div>
                                            {lb.notes && (
                                                <div className="mt-1 text-micro italic text-muted-foreground">
                                                    {lb.notes}
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
};

export default MealPlanning;
