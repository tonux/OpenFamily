import React, { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import {
    type Contact,
    type ContactCategory,
    CONTACT_CATEGORIES,
    useCreateContact,
    useUpdateContact,
    useEquipments,
} from '../../hooks/useHouse';
import { AlertCircle, Loader2 } from 'lucide-react';

// =============================================================================
// ContactDialog
//
// One dialog for both create and edit. Equipment selector pulls all the user's
// equipments so a single contact can be tied to e.g. "Chaudière Viessmann"
// (handy for "who fixes this?" lookups in Phase 4 / 5).
// =============================================================================

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    contact: Contact | null;
}

interface FormState {
    name: string;
    category: ContactCategory;
    company: string;
    phone: string;
    email: string;
    address: string;
    notes: string;
    last_intervention_date: string;
    is_favorite: boolean;
    equipment_id: string;
}

const blankForm = (): FormState => ({
    name: '',
    category: 'Plombier',
    company: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
    last_intervention_date: '',
    is_favorite: false,
    equipment_id: '',
});

const fromContact = (c: Contact): FormState => ({
    name: c.name,
    category: c.category,
    company: c.company ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    address: c.address ?? '',
    notes: c.notes ?? '',
    last_intervention_date: c.last_intervention_date ?? '',
    is_favorite: c.is_favorite,
    equipment_id: c.equipment_id ?? '',
});

const ContactDialog: React.FC<Props> = ({ open, onOpenChange, contact }) => {
    const isEdit = !!contact;
    const createMut = useCreateContact();
    const updateMut = useUpdateContact();
    const equipmentsQuery = useEquipments();
    const [form, setForm] = useState<FormState>(blankForm);
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setForm(contact ? fromContact(contact) : blankForm());
            setError('');
        }
    }, [open, contact]);

    const handleChange = <K extends keyof FormState>(key: K, value: FormState[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!form.name.trim()) {
            setError('Le nom du contact est requis.');
            return;
        }
        const body = {
            name: form.name.trim(),
            category: form.category,
            company: form.company.trim() || null,
            phone: form.phone.trim() || null,
            email: form.email.trim() || null,
            address: form.address.trim() || null,
            notes: form.notes.trim() || null,
            last_intervention_date: form.last_intervention_date || null,
            is_favorite: form.is_favorite,
            equipment_id: form.equipment_id || null,
        };
        try {
            if (isEdit && contact) {
                await updateMut.mutateAsync({ id: contact.id, patch: body });
            } else {
                await createMut.mutateAsync(body);
            }
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
        }
    };

    const submitting = createMut.isPending || updateMut.isPending;

    const equipmentOptions = [
        { value: '', label: 'Aucun équipement lié' },
        ...(equipmentsQuery.data ?? []).map((e) => ({
            value: e.id,
            label: `${e.name} (${e.category})`,
        })),
    ];

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={isEdit ? 'Modifier le contact' : 'Nouveau contact'}
            description={
                isEdit
                    ? contact?.name
                    : 'Plombier, électricien, médecin, voisin… ces gens à qui tu veux vite mettre la main dessus.'
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                        label="Nom *"
                        value={form.name}
                        onChange={(e) => handleChange('name', e.target.value)}
                        placeholder="M. Dupont"
                        required
                    />
                    <div>
                        <label className="block text-label font-medium text-foreground mb-1.5">
                            Catégorie *
                        </label>
                        <Select
                            value={form.category}
                            onValueChange={(v) => handleChange('category', v as ContactCategory)}
                            options={CONTACT_CATEGORIES.map((c) => ({ value: c, label: c }))}
                        />
                    </div>
                </div>
                <Input
                    label="Société (optionnel)"
                    value={form.company}
                    onChange={(e) => handleChange('company', e.target.value)}
                    placeholder="Plomberie Dupont SARL"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                        label="Téléphone"
                        type="tel"
                        value={form.phone}
                        onChange={(e) => handleChange('phone', e.target.value)}
                        placeholder="+33 6 12 34 56 78"
                    />
                    <Input
                        label="Email"
                        type="email"
                        value={form.email}
                        onChange={(e) => handleChange('email', e.target.value)}
                        placeholder="contact@exemple.fr"
                    />
                </div>
                <Textarea
                    label="Adresse"
                    value={form.address}
                    onChange={(e) => handleChange('address', e.target.value)}
                    placeholder="Optionnel"
                    rows={2}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                        label="Dernière intervention"
                        type="date"
                        value={form.last_intervention_date}
                        onChange={(e) => handleChange('last_intervention_date', e.target.value)}
                    />
                    <div>
                        <label className="block text-label font-medium text-foreground mb-1.5">
                            Équipement lié (optionnel)
                        </label>
                        <Select
                            value={form.equipment_id}
                            onValueChange={(v) => handleChange('equipment_id', v)}
                            options={equipmentOptions}
                        />
                    </div>
                </div>
                <Textarea
                    label="Notes"
                    value={form.notes}
                    onChange={(e) => handleChange('notes', e.target.value)}
                    placeholder="Tarif, horaires, qualité de service…"
                    rows={2}
                />
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={form.is_favorite}
                        onChange={(e) => handleChange('is_favorite', e.target.checked)}
                        className="h-4 w-4"
                    />
                    <span className="text-caption">
                        ⭐ Favori (affiché en tête de la catégorie)
                    </span>
                </label>
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

export default ContactDialog;
