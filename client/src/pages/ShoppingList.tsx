import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Check, ShoppingBag, Save, ListChecks, Sparkles, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Dialog } from '../components/ui';
import { useCurrency } from '../lib/useCurrency';
import {
    type ShoppingItem,
    type ShoppingTemplate,
    useApplyTemplate,
    useClearCheckedItems,
    useCreateShoppingItem,
    useCreateTemplate,
    useDeleteShoppingItem,
    useDeleteTemplate,
    useShoppingItems,
    useShoppingTemplates,
    useUpdateShoppingItem,
} from '../hooks/useShopping';
import { useParseShoppingText, type AiParsedItem } from '../hooks/useAiShopping';

const categories = ['Alimentation', 'Bebe', 'Menage', 'Sante', 'Autre'];

const parseOptionalPositiveNumber = (value: string): number | undefined => {
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const ShoppingList: React.FC = () => {
    const { format: formatMoney } = useCurrency();

    // React Query owns the data lifecycle now — cache, dedup, refetch on focus,
    // and (for write paths) optimistic updates with rollback are handled by the
    // hooks in useShopping. UI state stays here.
    const itemsQuery = useShoppingItems();
    const templatesQuery = useShoppingTemplates();
    const items: ShoppingItem[] = itemsQuery.data ?? [];
    const templates: ShoppingTemplate[] = templatesQuery.data ?? [];
    const loading = itemsQuery.isPending || templatesQuery.isPending;

    const createItem = useCreateShoppingItem();
    const updateItem = useUpdateShoppingItem();
    const deleteItemMutation = useDeleteShoppingItem();
    const clearCheckedMutation = useClearCheckedItems();
    const createTemplateMutation = useCreateTemplate();
    const applyTemplateMutation = useApplyTemplate();
    const deleteTemplateMutation = useDeleteTemplate();

    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [templateName, setTemplateName] = useState('');
    const [newItem, setNewItem] = useState({
        name: '',
        category: 'Alimentation',
        quantity: '',
        price: '',
        unit: '',
    });
    const [error, setError] = useState('');
    const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

    // AI: free-form text → list of items (PR #17).
    // - `aiText` is the textarea content
    // - `aiPreview` is the parsed result (null = nothing to review yet)
    // - per-line checkbox state lives in `aiKeep`
    const parseAi = useParseShoppingText();
    const [aiText, setAiText] = useState('');
    const [aiPreview, setAiPreview] = useState<AiParsedItem[] | null>(null);
    const [aiKeep, setAiKeep] = useState<boolean[]>([]);

    // Surface query errors in the same banner used by user actions.
    const fetchError =
        (itemsQuery.error instanceof Error ? itemsQuery.error.message : null) ??
        (templatesQuery.error instanceof Error ? templatesQuery.error.message : null);
    const displayedError = error || fetchError || '';

    const addItem = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!newItem.name.trim()) {
            setError("Le nom de l'article est obligatoire.");
            return;
        }

        const quantity = parseOptionalPositiveNumber(newItem.quantity);
        const price = parseOptionalPositiveNumber(newItem.price);

        if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0)) {
            setError('La quantité doit être un nombre positif.');
            return;
        }

        if (price !== undefined && (!Number.isFinite(price) || price < 0)) {
            setError('Le prix doit être un nombre valide.');
            return;
        }

        try {
            await createItem.mutateAsync({
                name: newItem.name,
                category: newItem.category,
                quantity,
                price,
                unit: newItem.unit || undefined,
            });
            setNewItem({
                name: '',
                category: 'Alimentation',
                quantity: '',
                price: '',
                unit: '',
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Impossible d'ajouter cet article.");
        }
    };

    const toggleItem = async (item: ShoppingItem) => {
        setError('');
        try {
            await updateItem.mutateAsync({
                id: item.id,
                patch: { is_checked: !item.is_checked },
            });
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Impossible de mettre à jour cet article.',
            );
        }
    };

    const deleteItem = async (id: string) => {
        setError('');
        try {
            await deleteItemMutation.mutateAsync(id);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Impossible de supprimer cet article.');
        }
    };

    const clearCheckedItems = async () => {
        setError('');
        try {
            await clearCheckedMutation.mutateAsync();
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Impossible de vider les articles cochés.',
            );
        }
    };

    const openTemplateDialog = () => {
        setError('');
        if (items.length === 0) {
            setError('Aucun article dans la liste pour créer un template.');
            return;
        }
        // Pre-select all items by default
        setSelectedItemIds(new Set(items.map((item) => item.id)));
        setTemplateDialogOpen(true);
    };

    const toggleItemSelection = (id: string) => {
        setSelectedItemIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectByCategory = (category: string) => {
        setSelectedItemIds((prev) => {
            const next = new Set(prev);
            items.filter((item) => item.category === category).forEach((item) => next.add(item.id));
            return next;
        });
    };

    const deselectByCategory = (category: string) => {
        setSelectedItemIds((prev) => {
            const next = new Set(prev);
            items
                .filter((item) => item.category === category)
                .forEach((item) => next.delete(item.id));
            return next;
        });
    };

    const saveTemplateFromDialog = async () => {
        setError('');
        const name = templateName.trim();
        if (!name) {
            setError('Donnez un nom au template.');
            return;
        }

        const templateItems = items
            .filter((item) => selectedItemIds.has(item.id))
            .map((item) => ({
                name: item.name,
                category: item.category,
                quantity: item.quantity,
                unit: item.unit,
                price: item.price,
                notes: item.notes,
            }));

        if (templateItems.length === 0) {
            setError('Sélectionnez au moins un article pour le template.');
            return;
        }

        try {
            await createTemplateMutation.mutateAsync({ name, items: templateItems });
            setTemplateName('');
            setTemplateDialogOpen(false);
            setSelectedItemIds(new Set());
        } catch (err) {
            setError(err instanceof Error ? err.message : "Impossible d'enregistrer le template.");
        }
    };

    const applyTemplate = async () => {
        setError('');
        if (!selectedTemplateId) {
            setError('Sélectionnez un template à appliquer.');
            return;
        }

        try {
            await applyTemplateMutation.mutateAsync(selectedTemplateId);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Impossible d'appliquer ce template.");
        }
    };

    const deleteTemplate = async () => {
        setError('');
        if (!selectedTemplateId) {
            setError('Sélectionnez un template à supprimer.');
            return;
        }

        try {
            await deleteTemplateMutation.mutateAsync(selectedTemplateId);
            setSelectedTemplateId('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Impossible de supprimer ce template.');
        }
    };

    // ------------------------------------------------------------------ //
    // AI handlers                                                         //
    // ------------------------------------------------------------------ //

    const runAiParse = async () => {
        setError('');
        const text = aiText.trim();
        if (!text) {
            setError('Décris tes courses en français pour utiliser l’IA.');
            return;
        }
        try {
            const items = await parseAi.mutateAsync(text);
            setAiPreview(items);
            setAiKeep(items.map(() => true));
        } catch (err) {
            setError(err instanceof Error ? err.message : "L'IA n'a pas pu analyser ce texte.");
        }
    };

    const dismissAiPreview = () => {
        setAiPreview(null);
        setAiKeep([]);
        setAiText('');
    };

    const acceptAiPreview = async () => {
        if (!aiPreview) return;
        setError('');
        const toCreate = aiPreview.filter((_, i) => aiKeep[i]);
        if (toCreate.length === 0) {
            dismissAiPreview();
            return;
        }
        try {
            // Sequential creates keep us under the per-IP rate limit and let
            // each row optimistically appear in the list as it's inserted.
            for (const item of toCreate) {
                await createItem.mutateAsync({
                    name: item.name,
                    category: item.category,
                    quantity: item.quantity ?? undefined,
                    unit: item.unit ?? undefined,
                });
            }
            dismissAiPreview();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Impossible d'ajouter ces articles.");
        }
    };

    const toggleAiKeep = (idx: number) => {
        setAiKeep((prev) => prev.map((v, i) => (i === idx ? !v : v)));
    };

    const pendingItems = useMemo(() => items.filter((item) => !item.is_checked), [items]);
    const completedItems = useMemo(() => items.filter((item) => item.is_checked), [items]);

    const totalPrice = useMemo(() => {
        return pendingItems.reduce((sum, item) => {
            const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
            const price = item.price || 0;
            return sum + quantity * price;
        }, 0);
    }, [pendingItems]);

    if (loading) {
        return (
            <div className="flex h-full min-h-[50vh] items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="spinner-brand" />
                    <p className="animate-pulse font-medium text-muted-foreground">
                        Chargement de votre liste...
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            {displayedError ? (
                <div className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-caption text-danger">
                    {displayedError}
                </div>
            ) : null}

            <div className="flex items-center gap-3">
                <div className="rounded-card bg-primary-soft p-3 text-primary">
                    <ShoppingBag className="h-7 w-7" />
                </div>
                <div>
                    <h1 className="text-h1 text-foreground">Liste de courses</h1>
                    <p className="text-body text-muted-foreground">
                        {pendingItems.length} articles restants
                    </p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-primary" />
                        Ajouter via l’IA
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-caption text-muted-foreground">
                        Décris tes courses en une phrase. Exemple : « ajoute du lait, 6 yaourts à la
                        fraise et 2 baguettes ».
                    </p>
                    <textarea
                        className="input-nexus min-h-[80px] py-2 text-caption"
                        placeholder="Ajoute du lait, 6 yaourts…"
                        value={aiText}
                        onChange={(e) => setAiText(e.target.value)}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            onClick={runAiParse}
                            disabled={parseAi.isPending || !aiText.trim()}
                        >
                            <Sparkles className="mr-1 h-4 w-4" />
                            {parseAi.isPending ? 'Analyse…' : 'Analyser'}
                        </Button>
                        {aiPreview ? (
                            <Button type="button" variant="secondary" onClick={dismissAiPreview}>
                                <X className="mr-1 h-4 w-4" />
                                Annuler
                            </Button>
                        ) : null}
                    </div>

                    {aiPreview ? (
                        <div className="mt-2 space-y-2">
                            <p className="text-caption font-medium text-foreground">
                                {aiPreview.length === 0
                                    ? 'Aucun article détecté.'
                                    : `${aiKeep.filter(Boolean).length}/${aiPreview.length} articles à ajouter`}
                            </p>
                            <ul className="space-y-1">
                                {aiPreview.map((item, idx) => (
                                    <li
                                        key={`${item.name}-${idx}`}
                                        className="flex items-center gap-3 rounded-input border border-border bg-card px-3 py-2 text-caption"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={aiKeep[idx] ?? true}
                                            onChange={() => toggleAiKeep(idx)}
                                            className="h-4 w-4"
                                            aria-label={`Conserver ${item.name}`}
                                        />
                                        <span className="flex-1 truncate">
                                            {item.quantity != null ? `${item.quantity} ` : ''}
                                            {item.unit ? `${item.unit} ` : ''}
                                            {item.name}
                                        </span>
                                        <span className="text-micro text-muted-foreground">
                                            {item.category}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            {aiPreview.length > 0 ? (
                                <Button
                                    type="button"
                                    onClick={acceptAiPreview}
                                    disabled={createItem.isPending}
                                >
                                    <Check className="mr-1 h-4 w-4" />
                                    Ajouter à la liste
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Ajouter un article</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={addItem} className="grid grid-cols-1 gap-4 md:grid-cols-8">
                        <div className="md:col-span-3">
                            <Input
                                label="Nom"
                                type="text"
                                value={newItem.name}
                                onChange={(e) =>
                                    setNewItem((prev) => ({ ...prev, name: e.target.value }))
                                }
                                placeholder="Ex: Lait, Pain"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="mb-1.5 block text-caption font-medium text-foreground">
                                Categorie
                            </label>
                            <select
                                value={newItem.category}
                                onChange={(e) =>
                                    setNewItem((prev) => ({ ...prev, category: e.target.value }))
                                }
                                className="input-nexus py-0 text-caption"
                            >
                                {categories.map((category) => (
                                    <option key={category} value={category}>
                                        {category}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <Input
                                label="Qt"
                                type="number"
                                min="0"
                                step="0.1"
                                value={newItem.quantity}
                                onChange={(e) =>
                                    setNewItem((prev) => ({ ...prev, quantity: e.target.value }))
                                }
                                placeholder="1"
                            />
                        </div>
                        <div>
                            <Input
                                label="Prix"
                                type="number"
                                min="0"
                                step="0.01"
                                value={newItem.price}
                                onChange={(e) =>
                                    setNewItem((prev) => ({ ...prev, price: e.target.value }))
                                }
                                placeholder="2.50"
                            />
                        </div>
                        <div className="md:col-span-8 flex justify-end">
                            <Button type="submit">
                                <Plus className="mr-1 h-4 w-4" />
                                Ajouter
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ListChecks className="h-5 w-5 text-primary" />
                        Templates de courses
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <Input
                            label="Nouveau template"
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            placeholder="Ex: Courses semaine"
                        />
                        <div className="md:col-span-2 flex items-end gap-2">
                            <Button
                                variant="secondary"
                                className="w-full md:w-auto"
                                onClick={openTemplateDialog}
                            >
                                <Save className="mr-1 h-4 w-4" />
                                Créer un template
                            </Button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div className="md:col-span-2">
                            <label className="mb-1.5 block text-caption font-medium text-foreground">
                                Template existant
                            </label>
                            <select
                                value={selectedTemplateId}
                                onChange={(e) => setSelectedTemplateId(e.target.value)}
                                className="input-nexus py-0 text-caption"
                            >
                                <option value="">Selectionner un template</option>
                                {templates.map((template) => (
                                    <option key={template.id} value={template.id}>
                                        {template.name} ({template.items?.length || 0} articles)
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-end gap-2">
                            <Button variant="secondary" className="flex-1" onClick={applyTemplate}>
                                Appliquer
                            </Button>
                            <Button
                                variant="ghost"
                                className="text-destructive hover:bg-destructive/10"
                                onClick={deleteTemplate}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="space-y-3">
                {pendingItems.length === 0 && completedItems.length === 0 ? (
                    <div className="rounded-card border border-dashed border-border bg-card py-16 text-center">
                        <ShoppingBag className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
                        <h3 className="text-body font-semibold text-foreground">
                            Votre liste est vide
                        </h3>
                        <p className="text-caption text-muted-foreground">
                            Ajoutez des articles ou appliquez un template.
                        </p>
                    </div>
                ) : (
                    <>
                        {pendingItems.map((item) => (
                            <div
                                key={item.id}
                                className="group flex items-center gap-4 rounded-card border border-border bg-card p-4 shadow-surface transition-all duration-fast ease-soft hover:border-border-strong"
                            >
                                <button
                                    type="button"
                                    onClick={() => toggleItem(item)}
                                    className="flex h-6 w-6 items-center justify-center rounded-md border-2 border-input"
                                >
                                    {item.is_checked ? (
                                        <Check className="h-3.5 w-3.5 text-primary" />
                                    ) : null}
                                </button>

                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-body font-medium text-foreground">
                                        {item.name}
                                    </p>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-micro">
                                        <span className="rounded-pill bg-primary-soft px-2 py-0.5 text-primary">
                                            {item.category}
                                        </span>
                                        {item.quantity ? (
                                            <span className="text-muted-foreground">
                                                Qt: {item.quantity}
                                            </span>
                                        ) : null}
                                        {item.price ? (
                                            <span className="text-muted-foreground">
                                                {formatMoney(item.price)}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>

                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => deleteItem(item.id)}
                                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}

                        {completedItems.length > 0 ? (
                            <div className="rounded-card border border-dashed border-border bg-muted/20 p-4">
                                <div className="mb-3 flex items-center justify-between">
                                    <p className="text-caption font-medium text-muted-foreground">
                                        Articles coches ({completedItems.length})
                                    </p>
                                    <Button variant="ghost" size="sm" onClick={clearCheckedItems}>
                                        Nettoyer
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    {completedItems.map((item) => (
                                        <div
                                            key={item.id}
                                            className="flex items-center gap-3 rounded-input border border-border bg-card px-3 py-2"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => toggleItem(item)}
                                                className="flex h-5 w-5 items-center justify-center rounded border border-primary bg-primary"
                                            >
                                                <Check className="h-3 w-3 text-white" />
                                            </button>
                                            <p className="line-through text-caption text-muted-foreground">
                                                {item.name}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </>
                )}
            </div>

            <div className="sticky bottom-20 z-20 rounded-card border border-border bg-card px-4 py-3 shadow-surface lg:bottom-4">
                <div className="flex items-center justify-between text-caption">
                    <span className="text-muted-foreground">Total estime</span>
                    <span className="text-body font-semibold text-foreground">
                        {formatMoney(totalPrice)}
                    </span>
                </div>
            </div>

            {/* Template creation dialog */}
            <Dialog
                open={templateDialogOpen}
                onOpenChange={setTemplateDialogOpen}
                title="Nouveau template de courses"
                description="Sélectionnez les articles à inclure dans ce template"
            >
                <div className="space-y-4">
                    <Input
                        label="Nom du template"
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        placeholder="Ex: Courses semaine, Fruits et légumes..."
                    />
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-label font-medium text-foreground">
                                Articles ({selectedItemIds.size}/{items.length} sélectionnés)
                            </span>
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                        setSelectedItemIds(new Set(items.map((i) => i.id)))
                                    }
                                >
                                    Tout sélectionner
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSelectedItemIds(new Set())}
                                >
                                    Tout désélectionner
                                </Button>
                            </div>
                        </div>
                        <div className="max-h-72 overflow-y-auto space-y-3 rounded-input border border-border p-3">
                            {categories.map((category) => {
                                const categoryItems = items.filter(
                                    (item) => item.category === category,
                                );
                                if (categoryItems.length === 0) return null;
                                const allSelected = categoryItems.every((item) =>
                                    selectedItemIds.has(item.id),
                                );
                                return (
                                    <div key={category}>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">
                                                {category} ({categoryItems.length})
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    allSelected
                                                        ? deselectByCategory(category)
                                                        : selectByCategory(category)
                                                }
                                                className="text-micro text-primary underline hover:no-underline"
                                            >
                                                {allSelected
                                                    ? 'Désélectionner'
                                                    : 'Tout sélectionner'}
                                            </button>
                                        </div>
                                        <div className="space-y-1 pl-1">
                                            {categoryItems.map((item) => (
                                                <label
                                                    key={item.id}
                                                    className="flex items-center gap-2 cursor-pointer hover:bg-nexus-background rounded px-1 py-0.5"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedItemIds.has(item.id)}
                                                        onChange={() =>
                                                            toggleItemSelection(item.id)
                                                        }
                                                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                                                    />
                                                    <span
                                                        className={`text-body-sm ${item.is_checked ? 'line-through text-muted-foreground' : 'text-foreground'}`}
                                                    >
                                                        {item.name}
                                                        {item.quantity
                                                            ? ` · ${item.quantity}${item.unit ? ' ' + item.unit : ''}`
                                                            : ''}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setTemplateDialogOpen(false)}
                        >
                            Annuler
                        </Button>
                        <Button type="button" onClick={saveTemplateFromDialog}>
                            <Save className="mr-1 h-4 w-4" />
                            Créer le template
                        </Button>
                    </div>
                </div>
            </Dialog>
        </div>
    );
};

export default ShoppingList;
