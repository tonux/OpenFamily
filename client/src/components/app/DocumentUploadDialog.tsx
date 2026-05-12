import React, { useEffect, useRef, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import {
    DOCUMENT_CATEGORIES,
    type DocumentCategory,
    type DocumentEntityType,
    useUploadDocument,
} from '../../hooks/useDocuments';
import { AlertCircle, Loader2, Upload } from 'lucide-react';

// =============================================================================
// DocumentUploadDialog
//
// Two modes:
//   - Free: opened from the Documents tab. User chooses what to attach to.
//   - Bound: opened from a detail panel (équipement, contrat, …). Entity is
//     pre-fixed and not editable.
// =============================================================================

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * If set, locks the document to a specific entity. Hides the entity
     * selector. Useful from EquipmentDetailDialog etc.
     */
    boundEntity?: { type: DocumentEntityType; id: string; label?: string } | null;
}

const MAX_MB = Number(import.meta.env.VITE_MAX_UPLOAD_SIZE_MB) || 50;

const DocumentUploadDialog: React.FC<Props> = ({ open, onOpenChange, boundEntity }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [name, setName] = useState('');
    const [category, setCategory] = useState<DocumentCategory>('Facture');
    const [notes, setNotes] = useState('');
    const [progress, setProgress] = useState<number | null>(null);
    const [error, setError] = useState('');
    const uploadMut = useUploadDocument();

    useEffect(() => {
        if (open) {
            setFile(null);
            setName('');
            setCategory('Facture');
            setNotes('');
            setProgress(null);
            setError('');
        }
    }, [open]);

    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0] ?? null;
        setFile(f);
        setError('');
        if (f && !name) {
            // Default the friendly name to the file name minus extension —
            // the user can edit before submitting.
            const dot = f.name.lastIndexOf('.');
            setName(dot > 0 ? f.name.slice(0, dot) : f.name);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!file) {
            setError('Choisis un fichier à uploader.');
            return;
        }
        if (file.size > MAX_MB * 1024 * 1024) {
            setError(`Fichier trop volumineux (max ${MAX_MB} MB).`);
            return;
        }
        if (!name.trim()) {
            setError('Donne un nom au document.');
            return;
        }
        try {
            setProgress(0);
            await uploadMut.mutateAsync({
                file,
                name: name.trim(),
                category,
                notes: notes.trim() || undefined,
                entity_type: boundEntity?.type,
                entity_id: boundEntity?.id,
                onProgress: (p) => setProgress(p),
            });
            onOpenChange(false);
        } catch (err) {
            const e2 = err as { code?: string; message?: string };
            if (e2.code === 'FILE_TOO_LARGE') {
                setError(`Fichier trop volumineux (max ${MAX_MB} MB).`);
            } else if (e2.code === 'UNSUPPORTED_MIME') {
                setError(
                    'Type de fichier non supporté (PDF, JPG, PNG, WEBP, DOCX, XLSX uniquement).',
                );
            } else {
                setError(e2.message || 'Échec de l’upload.');
            }
            setProgress(null);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title="Ajouter un document"
            description={
                boundEntity?.label
                    ? `Sera attaché à : ${boundEntity.label}`
                    : "PDF, image (JPG/PNG/WEBP), DOCX, XLSX — jusqu'à " + MAX_MB + ' MB.'
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

                <div>
                    <label className="block text-label font-medium text-foreground mb-1.5">
                        Fichier *
                    </label>
                    <label className="flex items-center justify-center gap-2 rounded-input border-2 border-dashed border-border bg-muted/20 px-4 py-6 cursor-pointer hover:bg-muted/30">
                        <Upload className="h-5 w-5 text-muted-foreground" />
                        <span className="text-caption text-muted-foreground">
                            {file ? file.name : 'Choisir un fichier…'}
                        </span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.docx,.xlsx,.doc,.xls,.txt"
                            onChange={onFileChange}
                            className="sr-only"
                        />
                    </label>
                    {file && (
                        <p className="mt-1 text-micro text-muted-foreground">
                            {(file.size / (1024 * 1024)).toFixed(2)} MB ·{' '}
                            {file.type || 'type inconnu'}
                        </p>
                    )}
                </div>

                <Input
                    label="Nom *"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Facture EDF janvier 2026"
                    required
                />

                <div>
                    <label className="block text-label font-medium text-foreground mb-1.5">
                        Catégorie *
                    </label>
                    <Select
                        value={category}
                        onValueChange={(v) => setCategory(v as DocumentCategory)}
                        options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: c }))}
                    />
                </div>

                <Textarea
                    label="Notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optionnel — n° de référence, contexte…"
                    rows={2}
                />

                {progress !== null && (
                    <div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                            <div
                                className="h-full bg-primary transition-all"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <p className="mt-1 text-micro text-muted-foreground text-center">
                            Upload {progress}%
                        </p>
                    </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                        Annuler
                    </Button>
                    <Button type="submit" disabled={uploadMut.isPending || !file}>
                        {uploadMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Uploader
                    </Button>
                </div>
            </form>
        </Dialog>
    );
};

export default DocumentUploadDialog;
