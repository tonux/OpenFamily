import React, { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import {
    type Room,
    type RoomCategory,
    ROOM_CATEGORIES,
    useCreateRoom,
    useUpdateRoom,
} from '../../hooks/useHouse';
import { AlertCircle, Loader2 } from 'lucide-react';

// Default colors picked to be visually distinguishable in a swatch row.
const ROOM_COLORS = [
    '#3B82F6', // blue
    '#10B981', // emerald
    '#F59E0B', // amber
    '#EF4444', // red
    '#8B5CF6', // violet
    '#EC4899', // pink
    '#06B6D4', // cyan
    '#84CC16', // lime
    '#6B7280', // gray
];

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    room: Room | null;
}

interface FormState {
    name: string;
    category: RoomCategory;
    color: string;
    notes: string;
}

const blankForm = (): FormState => ({
    name: '',
    category: 'Salon',
    color: ROOM_COLORS[0],
    notes: '',
});

const fromRoom = (r: Room): FormState => ({
    name: r.name,
    category: r.category,
    color: r.color,
    notes: r.notes ?? '',
});

const RoomDialog: React.FC<Props> = ({ open, onOpenChange, room }) => {
    const isEdit = !!room;
    const createMut = useCreateRoom();
    const updateMut = useUpdateRoom();
    const [form, setForm] = useState<FormState>(blankForm);
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setForm(room ? fromRoom(room) : blankForm());
            setError('');
        }
    }, [open, room]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!form.name.trim()) {
            setError('Le nom de la pièce est requis.');
            return;
        }
        const body = {
            name: form.name.trim(),
            category: form.category,
            color: form.color,
            notes: form.notes.trim() || null,
        };
        try {
            if (isEdit && room) {
                await updateMut.mutateAsync({ id: room.id, patch: body });
            } else {
                await createMut.mutateAsync(body);
            }
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
        }
    };

    const submitting = createMut.isPending || updateMut.isPending;

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={isEdit ? 'Modifier la pièce' : 'Nouvelle pièce'}
            description={
                isEdit
                    ? room?.name
                    : 'Salon, cuisine, chambre, garage… toutes les zones de la maison où tu ranges des choses.'
            }
            className="sm:max-w-md"
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
                    placeholder="Ex: Garage"
                    required
                />
                <div>
                    <label className="block text-label font-medium text-foreground mb-1.5">
                        Catégorie *
                    </label>
                    <Select
                        value={form.category}
                        onValueChange={(v) => setForm({ ...form, category: v as RoomCategory })}
                        options={ROOM_CATEGORIES.map((c) => ({ value: c, label: c }))}
                    />
                </div>
                <div>
                    <label className="block text-label font-medium text-foreground mb-1.5">
                        Couleur
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {ROOM_COLORS.map((c) => (
                            <button
                                key={c}
                                type="button"
                                onClick={() => setForm({ ...form, color: c })}
                                className={`h-7 w-7 rounded-full border-2 ${
                                    form.color === c ? 'border-foreground' : 'border-border'
                                }`}
                                style={{ background: c }}
                                aria-label={`Couleur ${c}`}
                            />
                        ))}
                    </div>
                </div>
                <Textarea
                    label="Notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Particularités, code accès…"
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

export default RoomDialog;
