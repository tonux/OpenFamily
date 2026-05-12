import React, { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import {
    PROJECT_CATEGORIES,
    PROJECT_STATUSES,
    type Project,
    type ProjectCategory,
    type ProjectStatus,
    useCreateProject,
    useUpdateProject,
} from '../../hooks/useHouse';
import { AlertCircle, Loader2 } from 'lucide-react';

// =============================================================================
// ProjectDialog
//
// Single dialog for both create and edit. Checklist editing isn't done here
// (see ProjectDetail in House.tsx) — too noisy when you're just creating
// the shell. The user can add items right after creation from the detail
// view.
// =============================================================================

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    project: Project | null;
}

interface FormState {
    name: string;
    category: ProjectCategory;
    status: ProjectStatus;
    description: string;
    planned_budget: string;
    started_at: string;
    target_end: string;
    completed_at: string;
    notes: string;
}

const blankForm = (): FormState => ({
    name: '',
    category: 'Rénovation',
    status: 'Idée',
    description: '',
    planned_budget: '',
    started_at: '',
    target_end: '',
    completed_at: '',
    notes: '',
});

const fromProject = (p: Project): FormState => ({
    name: p.name,
    category: p.category,
    status: p.status,
    description: p.description ?? '',
    planned_budget: p.planned_budget !== null ? String(p.planned_budget) : '',
    started_at: p.started_at ?? '',
    target_end: p.target_end ?? '',
    completed_at: p.completed_at ?? '',
    notes: p.notes ?? '',
});

const ProjectDialog: React.FC<Props> = ({ open, onOpenChange, project }) => {
    const isEdit = !!project;
    const createMut = useCreateProject();
    const updateMut = useUpdateProject();
    const [form, setForm] = useState<FormState>(blankForm);
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setForm(project ? fromProject(project) : blankForm());
            setError('');
        }
    }, [open, project]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!form.name.trim()) {
            setError('Le nom du projet est requis.');
            return;
        }
        let plannedBudget: number | null = null;
        if (form.planned_budget.trim()) {
            const n = Number(form.planned_budget.replace(',', '.'));
            if (!Number.isFinite(n) || n < 0) {
                setError('Le budget prévu doit être un nombre positif.');
                return;
            }
            plannedBudget = n;
        }
        const body = {
            name: form.name.trim(),
            category: form.category,
            status: form.status,
            description: form.description.trim() || null,
            planned_budget: plannedBudget,
            started_at: form.started_at || null,
            target_end: form.target_end || null,
            completed_at: form.completed_at || null,
            notes: form.notes.trim() || null,
        };
        try {
            if (isEdit && project) {
                await updateMut.mutateAsync({ id: project.id, patch: body });
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
            title={isEdit ? 'Modifier le projet' : 'Nouveau projet'}
            description={
                isEdit
                    ? project?.name
                    : 'Rénovation cuisine, peinture, jardin, sécurité… tout ce qui demande planning + budget + suivi.'
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
                    placeholder="Ex: Refaire la cuisine"
                    required
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-label font-medium text-foreground mb-1.5">
                            Catégorie *
                        </label>
                        <Select
                            value={form.category}
                            onValueChange={(v) =>
                                setForm({ ...form, category: v as ProjectCategory })
                            }
                            options={PROJECT_CATEGORIES.map((c) => ({ value: c, label: c }))}
                        />
                    </div>
                    <div>
                        <label className="block text-label font-medium text-foreground mb-1.5">
                            Statut
                        </label>
                        <Select
                            value={form.status}
                            onValueChange={(v) => setForm({ ...form, status: v as ProjectStatus })}
                            options={PROJECT_STATUSES.map((s) => ({ value: s, label: s }))}
                        />
                    </div>
                </div>
                <Textarea
                    label="Description"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Le pourquoi du projet, le périmètre…"
                    rows={3}
                />
                <Input
                    label="Budget prévu"
                    type="number"
                    step="0.01"
                    value={form.planned_budget}
                    onChange={(e) => setForm({ ...form, planned_budget: e.target.value })}
                    placeholder="Optionnel — ex: 12000"
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Input
                        label="Début"
                        type="date"
                        value={form.started_at}
                        onChange={(e) => setForm({ ...form, started_at: e.target.value })}
                    />
                    <Input
                        label="Cible"
                        type="date"
                        value={form.target_end}
                        onChange={(e) => setForm({ ...form, target_end: e.target.value })}
                    />
                    <Input
                        label="Terminé le"
                        type="date"
                        value={form.completed_at}
                        onChange={(e) => setForm({ ...form, completed_at: e.target.value })}
                    />
                </div>
                <Textarea
                    label="Notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Décisions, contacts, idées…"
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

export default ProjectDialog;
