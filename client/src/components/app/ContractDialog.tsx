import React, { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import {
    type Contract,
    type ContractCategory,
    type ContractFrequency,
    type PaymentMethod,
    CONTRACT_CATEGORIES,
    CONTRACT_FREQUENCIES,
    PAYMENT_METHODS,
    useCreateContract,
    useUpdateContract,
} from '../../hooks/useHouse';
import { AlertCircle, Loader2 } from 'lucide-react';

// Default budget category to suggest based on the contract category. The user
// can override at the bottom of the form. Mirrors the budget_entries free-form
// categories used elsewhere in the app.
const DEFAULT_BUDGET_CATEGORY: Record<ContractCategory, string> = {
    Énergie: 'Maison',
    Eau: 'Maison',
    Internet: 'Maison',
    Téléphone: 'Maison',
    Streaming: 'Loisirs',
    Assurance: 'Maison',
    Prêt: 'Maison',
    Abonnement: 'Loisirs',
    Autre: 'Autre',
};

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    contract: Contract | null;
}

interface FormState {
    name: string;
    provider: string;
    category: ContractCategory;
    amount: string;
    frequency: ContractFrequency;
    next_due_date: string;
    payment_method: PaymentMethod | '';
    client_number: string;
    notes: string;
    is_active: boolean;
    auto_create_budget_entry: boolean;
    budget_category: string;
}

const blankForm = (): FormState => ({
    name: '',
    provider: '',
    category: 'Énergie',
    amount: '',
    frequency: 'Mensuel',
    next_due_date: new Date().toISOString().slice(0, 10),
    payment_method: 'Prélèvement auto',
    client_number: '',
    notes: '',
    is_active: true,
    auto_create_budget_entry: true,
    budget_category: DEFAULT_BUDGET_CATEGORY['Énergie'],
});

const fromContract = (c: Contract): FormState => ({
    name: c.name,
    provider: c.provider ?? '',
    category: c.category,
    amount: String(c.amount),
    frequency: c.frequency,
    next_due_date: c.next_due_date,
    payment_method: (c.payment_method ?? '') as PaymentMethod | '',
    client_number: c.client_number ?? '',
    notes: c.notes ?? '',
    is_active: c.is_active,
    auto_create_budget_entry: c.auto_create_budget_entry,
    budget_category: c.budget_category ?? DEFAULT_BUDGET_CATEGORY[c.category],
});

const ContractDialog: React.FC<Props> = ({ open, onOpenChange, contract }) => {
    const isEdit = !!contract;
    const createMut = useCreateContract();
    const updateMut = useUpdateContract();
    const [form, setForm] = useState<FormState>(blankForm);
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setForm(contract ? fromContract(contract) : blankForm());
            setError('');
        }
    }, [open, contract]);

    const handleChange = <K extends keyof FormState>(key: K, value: FormState[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    // Update suggested budget category when category changes — but only if
    // the user hasn't manually overridden it (we detect that by comparing
    // to the default for the *previous* category).
    const handleCategoryChange = (next: ContractCategory) => {
        setForm((prev) => {
            const wasDefault = prev.budget_category === DEFAULT_BUDGET_CATEGORY[prev.category];
            return {
                ...prev,
                category: next,
                budget_category: wasDefault ? DEFAULT_BUDGET_CATEGORY[next] : prev.budget_category,
            };
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!form.name.trim()) {
            setError('Le nom du contrat est requis.');
            return;
        }
        const amount = Number(form.amount.replace(',', '.'));
        if (!Number.isFinite(amount) || amount < 0) {
            setError('Le montant doit être un nombre positif.');
            return;
        }
        if (!form.next_due_date) {
            setError('La prochaine échéance est requise.');
            return;
        }
        const body = {
            name: form.name.trim(),
            provider: form.provider.trim() || null,
            category: form.category,
            amount,
            frequency: form.frequency,
            next_due_date: form.next_due_date,
            payment_method: form.payment_method || undefined,
            client_number: form.client_number.trim() || null,
            notes: form.notes.trim() || null,
            is_active: form.is_active,
            auto_create_budget_entry: form.auto_create_budget_entry,
            budget_category: form.budget_category.trim() || null,
        };
        try {
            if (isEdit && contract) {
                await updateMut.mutateAsync({ id: contract.id, patch: body });
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
            title={isEdit ? 'Modifier le contrat' : 'Nouveau contrat / facture'}
            description={
                isEdit ? contract?.name : 'EDF, eau, internet, abonnement, assurance, prêt…'
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
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder="Ex: Box internet"
                    required
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                        label="Fournisseur"
                        value={form.provider}
                        onChange={(e) => handleChange('provider', e.target.value)}
                        placeholder="Free, EDF, Veolia…"
                    />
                    <div>
                        <label className="block text-label font-medium text-foreground mb-1.5">
                            Catégorie *
                        </label>
                        <Select
                            value={form.category}
                            onValueChange={(v) => handleCategoryChange(v as ContractCategory)}
                            options={CONTRACT_CATEGORIES.map((c) => ({ value: c, label: c }))}
                        />
                    </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                        label="Montant *"
                        type="number"
                        step="0.01"
                        value={form.amount}
                        onChange={(e) => handleChange('amount', e.target.value)}
                        placeholder="0.00"
                        required
                    />
                    <div>
                        <label className="block text-label font-medium text-foreground mb-1.5">
                            Fréquence *
                        </label>
                        <Select
                            value={form.frequency}
                            onValueChange={(v) => handleChange('frequency', v as ContractFrequency)}
                            options={CONTRACT_FREQUENCIES.map((f) => ({ value: f, label: f }))}
                        />
                    </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                        label="Prochaine échéance *"
                        type="date"
                        value={form.next_due_date}
                        onChange={(e) => handleChange('next_due_date', e.target.value)}
                        required
                    />
                    <div>
                        <label className="block text-label font-medium text-foreground mb-1.5">
                            Paiement
                        </label>
                        <Select
                            value={form.payment_method || 'Prélèvement auto'}
                            onValueChange={(v) =>
                                handleChange('payment_method', v as PaymentMethod)
                            }
                            options={PAYMENT_METHODS.map((p) => ({ value: p, label: p }))}
                        />
                    </div>
                </div>
                <Input
                    label="N° client / référence"
                    value={form.client_number}
                    onChange={(e) => handleChange('client_number', e.target.value)}
                    placeholder="Optionnel"
                />
                <Textarea
                    label="Notes"
                    value={form.notes}
                    onChange={(e) => handleChange('notes', e.target.value)}
                    placeholder="Conditions, n° de contrat, contact SAV…"
                    rows={2}
                />

                {/* Budget integration */}
                <div className="rounded-card border border-border bg-surface-2/40 p-3 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={form.auto_create_budget_entry}
                            onChange={(e) =>
                                handleChange('auto_create_budget_entry', e.target.checked)
                            }
                            className="h-4 w-4"
                        />
                        <span className="text-caption font-medium">
                            Créer une dépense Budget à chaque paiement
                        </span>
                    </label>
                    {form.auto_create_budget_entry && (
                        <div className="pl-6">
                            <Input
                                label="Catégorie Budget"
                                value={form.budget_category}
                                onChange={(e) => handleChange('budget_category', e.target.value)}
                                placeholder="Maison, Loisirs, Autre…"
                            />
                        </div>
                    )}
                </div>

                {isEdit && (
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={form.is_active}
                            onChange={(e) => handleChange('is_active', e.target.checked)}
                            className="h-4 w-4"
                        />
                        <span className="text-caption">Contrat actif</span>
                    </label>
                )}

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

export default ContractDialog;
