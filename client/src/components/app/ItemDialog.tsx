import React, { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import {
    type HouseItem,
    type ItemCategory,
    ITEM_CATEGORIES,
    useCreateItem,
    useUpdateItem,
    useRooms,
} from '../../hooks/useHouse';
import { AlertCircle, Loader2 } from 'lucide-react';

// =============================================================================
// ItemDialog
//
// Single dialog for create/edit. The room selector is pre-populated from
// the user's rooms list; "À ranger" (no room) stays a valid option so the
// user can register an item before deciding where it goes.
// =============================================================================

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: HouseItem | null;
    /** Pre-select a room when creating from inside a room view. */
    defaultRoomId?: string | null;
}

interface FormState {
    name: string;
    category: ItemCategory;
    room_id: string;
    quantity: string;
    location_detail: string;
    photo_url: string;
    notes: string;
}

const blankForm = (defaultRoomId?: string | null): FormState => ({
    name: '',
    category: 'Autre',
    room_id: defaultRoomId ?? '',
    quantity: '',
    location_detail: '',
    photo_url: '',
    notes: '',
});

const fromItem = (i: HouseItem): FormState => ({
    name: i.name,
    category: i.category,
    room_id: i.room_id ?? '',
    quantity: i.quantity !== null ? String(i.quantity) : '',
    location_detail: i.location_detail ?? '',
    photo_url: i.photo_url ?? '',
    notes: i.notes ?? '',
});

const ItemDialog: React.FC<Props> = ({ open, onOpenChange, item, defaultRoomId }) => {
    const isEdit = !!item;
    const createMut = useCreateItem();
    const updateMut = useUpdateItem();
    const roomsQuery = useRooms();
    const [form, setForm] = useState<FormState>(blankForm);
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setForm(item ? fromItem(item) : blankForm(defaultRoomId));
            setError('');
        }
    }, [open, item, defaultRoomId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!form.name.trim()) {
            setError("Le nom de l'objet est requis.");
            return;
        }
        let quantity: number | null = null;
        if (form.quantity.trim()) {
            const n = Number(form.quantity);
            if (!Number.isInteger(n) || n < 1) {
                setError('La quantité doit être un entier ≥ 1.');
                return;
            }
            quantity = n;
        }
        const body = {
            name: form.name.trim(),
            category: form.category,
            room_id: form.room_id || null,
            quantity,
            location_detail: form.location_detail.trim() || null,
            photo_url: form.photo_url.trim() || null,
            notes: form.notes.trim() || null,
        };
        try {
            if (isEdit && item) {
                await updateMut.mutateAsync({ id: item.id, patch: body });
            } else {
                await createMut.mutateAsync(body);
            }
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
        }
    };

    const submitting = createMut.isPending || updateMut.isPending;
    const roomOptions = [
        { value: '', label: 'Aucune (À ranger)' },
        ...(roomsQuery.data ?? []).map((r) => ({ value: r.id, label: r.name })),
    ];

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={isEdit ? "Modifier l'objet" : 'Nouvel objet'}
            description={
                isEdit
                    ? item?.name
                    : 'Ajoute ce que tu ranges quelque part : tournevis, passeports, médicaments, déco saisonnière…'
            }
            className="sm:max-w-xl"
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                    <p className="flex items-center gap-1 text-micro text-destructive">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                    </p>
                )}
                <Input
                    label="Nom *"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ex: Perceuse Bosch"
                    required
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-label font-medium text-foreground mb-1.5">
                            Catégorie *
                        </label>
                        <Select
                            value={form.category}
                            onValueChange={(v) => setForm({ ...form, category: v as ItemCategory })}
                            options={ITEM_CATEGORIES.map((c) => ({ value: c, label: c }))}
                        />
                    </div>
                    <Input
                        label="Quantité"
                        type="number"
                        min={1}
                        value={form.quantity}
                        onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                        placeholder="Optionnel"
                    />
                </div>
                <div>
                    <label className="block text-label font-medium text-foreground mb-1.5">
                        Pièce
                    </label>
                    <Select
                        value={form.room_id}
                        onValueChange={(v) => setForm({ ...form, room_id: v })}
                        options={roomOptions}
                    />
                </div>
                <Input
                    label="Emplacement précis"
                    value={form.location_detail}
                    onChange={(e) => setForm({ ...form, location_detail: e.target.value })}
                    placeholder="Tiroir du haut, étagère verte, boîte à outils…"
                />
                <Input
                    label="Photo (URL)"
                    value={form.photo_url}
                    onChange={(e) => setForm({ ...form, photo_url: e.target.value })}
                    placeholder="https://…  (l'upload arrivera plus tard)"
                />
                <Textarea
                    label="Notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Garantie, prêté à…"
                    rows={2}
                />
                <div className="flex justify-end gap-3 pt-2">
                    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                        Annuler
                    </Button>
                    <Button type="submit" disabled={submitting}>
                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isEdit ? 'Enregistrer' : 'Créer'}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
};

export default ItemDialog;
