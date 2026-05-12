import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
    Plus,
    Wrench,
    ShieldCheck,
    Calendar as CalendarIcon,
    Trash2,
    Edit2,
    Search,
    AlertCircle,
    CheckCircle2,
    History as HistoryIcon,
    Receipt,
    Pause,
    Repeat,
    Phone,
    Mail,
    MapPin,
    Star,
    UserRound,
    DoorOpen,
    Package,
    ArrowRight,
    PackageOpen,
    FileText,
    FolderOpen,
    Square,
    CheckSquare,
    GripVertical,
} from 'lucide-react';
import { Card, CardContent, Button, Input, Tabs, Dialog, useToast } from '../components/ui';
import EquipmentDialog from '../components/app/EquipmentDialog';
import MaintenanceDialog from '../components/app/MaintenanceDialog';
import ContractDialog from '../components/app/ContractDialog';
import ContactDialog from '../components/app/ContactDialog';
import RoomDialog from '../components/app/RoomDialog';
import ItemDialog from '../components/app/ItemDialog';
import ProjectDialog from '../components/app/ProjectDialog';
import DocumentsList from '../components/app/DocumentsList';
import DocumentUploadDialog from '../components/app/DocumentUploadDialog';
import { PROJECT_STATUS_COLORS } from '../design/colorPresets';
import {
    DOCUMENT_CATEGORIES,
    type DocumentCategory,
    type HouseDocument,
    documentFileUrl,
    formatFileSize,
    isPdf,
    isPreviewableImage,
    useDeleteDocument,
    useDocuments,
} from '../hooks/useDocuments';
import {
    EQUIPMENT_CATEGORIES,
    type Equipment,
    type EquipmentCategory,
    type Maintenance,
    type Contract,
    type Contact,
    type ContactCategory,
    type Room,
    type HouseItem,
    type Project,
    type ProjectStatus,
    CONTACT_CATEGORIES,
    PROJECT_STATUSES,
    useEquipments,
    useMaintenance,
    useDeleteEquipment,
    useDeleteMaintenance,
    useUpdateMaintenance,
    useContracts,
    useDeleteContract,
    usePayContract,
    useContacts,
    useDeleteContact,
    useRooms,
    useItems,
    useDeleteRoom,
    useDeleteItem,
    useProjects,
    useDeleteProject,
    useUpdateProject,
    useUpdateProjectChecklist,
} from '../hooks/useHouse';

// =============================================================================
// /house — Phase 1 of the Maison section.
// Two active tabs (Équipements, Entretiens), two placeholder tabs
// (Factures, Contacts pro) for the upcoming roadmap modules.
// =============================================================================

const formatDate = (d: string | null): string =>
    d ? format(parseISO(d), 'dd MMM yyyy', { locale: fr }) : '—';

const daysUntil = (d: string): number => {
    const target = new Date(`${d}T12:00:00`).getTime();
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return Math.round((target - today.getTime()) / (24 * 60 * 60 * 1000));
};

const House: React.FC = () => {
    const tabs = [
        { value: 'equipments', label: 'Équipements', content: <EquipmentsTab /> },
        { value: 'maintenance', label: 'Entretiens', content: <MaintenanceTab /> },
        { value: 'bills', label: 'Factures', content: <ContractsTab /> },
        { value: 'contacts', label: 'Contacts pro', content: <ContactsTab /> },
        { value: 'storage', label: 'Rangement', content: <StorageTab /> },
        { value: 'documents', label: 'Documents', content: <DocumentsTab /> },
        { value: 'projects', label: 'Projets', content: <ProjectsTab /> },
    ];

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div>
                <h1 className="text-h1 mb-1">Maison</h1>
                <p className="text-muted-foreground text-body">
                    Suis tes équipements, entretiens et — bientôt — contrats, contacts et travaux.
                </p>
            </div>
            <Tabs tabs={tabs} />
        </div>
    );
};

// ---------- Équipements tab ----------

const EquipmentsTab: React.FC = () => {
    const [category, setCategory] = useState<EquipmentCategory | 'all'>('all');
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const equipmentsQuery = useEquipments({
        category: category === 'all' ? undefined : category,
        q: search || undefined,
    });
    const deleteMut = useDeleteEquipment();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Equipment | null>(null);
    const [detailFor, setDetailFor] = useState<Equipment | null>(null);

    const onSubmitSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setSearch(searchInput.trim());
    };

    const handleDelete = async (eq: Equipment) => {
        if (!confirm(`Supprimer "${eq.name}" et tous ses entretiens ?`)) return;
        try {
            await deleteMut.mutateAsync(eq.id);
            if (detailFor?.id === eq.id) setDetailFor(null);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Suppression impossible.');
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <form
                    onSubmit={onSubmitSearch}
                    className="flex items-center gap-2 w-full md:max-w-md"
                >
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Rechercher (nom, marque, modèle)…"
                            className="pl-9"
                        />
                    </div>
                </form>
                <Button
                    onClick={() => {
                        setEditing(null);
                        setDialogOpen(true);
                    }}
                >
                    <Plus className="h-4 w-4 mr-2" />
                    Ajouter un équipement
                </Button>
            </div>

            <div className="flex flex-wrap gap-2">
                <CategoryChip
                    label="Tous"
                    active={category === 'all'}
                    onClick={() => setCategory('all')}
                />
                {EQUIPMENT_CATEGORIES.map((c) => (
                    <CategoryChip
                        key={c}
                        label={c}
                        active={category === c}
                        onClick={() => setCategory(c)}
                    />
                ))}
            </div>

            {equipmentsQuery.isPending ? (
                <SkeletonGrid />
            ) : equipmentsQuery.isError ? (
                <ErrorBanner
                    message={
                        equipmentsQuery.error instanceof Error
                            ? equipmentsQuery.error.message
                            : 'Erreur'
                    }
                />
            ) : equipmentsQuery.data && equipmentsQuery.data.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {equipmentsQuery.data.map((eq) => (
                        <EquipmentCard
                            key={eq.id}
                            equipment={eq}
                            onOpen={() => setDetailFor(eq)}
                            onEdit={() => {
                                setEditing(eq);
                                setDialogOpen(true);
                            }}
                            onDelete={() => handleDelete(eq)}
                        />
                    ))}
                </div>
            ) : (
                <EmptyState
                    title="Aucun équipement enregistré"
                    description="Commence par ajouter ta chaudière, ton lave-linge ou ta voiture pour suivre les entretiens et les garanties."
                    actionLabel="Ajouter un équipement"
                    onAction={() => {
                        setEditing(null);
                        setDialogOpen(true);
                    }}
                />
            )}

            <EquipmentDialog open={dialogOpen} onOpenChange={setDialogOpen} equipment={editing} />

            {detailFor && (
                <EquipmentDetailDialog
                    equipment={detailFor}
                    open={!!detailFor}
                    onOpenChange={(open) => !open && setDetailFor(null)}
                    onEdit={() => {
                        setEditing(detailFor);
                        setDialogOpen(true);
                    }}
                />
            )}
        </div>
    );
};

const CategoryChip: React.FC<{
    label: string;
    active: boolean;
    onClick: () => void;
}> = ({ label, active, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className={`rounded-pill px-3 py-1.5 text-caption font-medium border transition-colors ${
            active
                ? 'bg-primary text-white border-primary'
                : 'bg-card text-foreground border-border hover:bg-surface-2'
        }`}
    >
        {label}
    </button>
);

const EquipmentCard: React.FC<{
    equipment: Equipment;
    onOpen: () => void;
    onEdit: () => void;
    onDelete: () => void;
}> = ({ equipment, onOpen, onEdit, onDelete }) => {
    const warranty = equipment.warranty_until ? daysUntil(equipment.warranty_until) : null;
    const warrantyStatus =
        warranty === null
            ? null
            : warranty < 0
              ? { label: 'Garantie expirée', className: 'text-destructive bg-destructive/10' }
              : warranty < 60
                ? {
                      label: `Garantie : ${warranty}j`,
                      className: 'text-warning bg-warning-soft',
                  }
                : {
                      label: `Garantie OK`,
                      className: 'text-success bg-success-soft',
                  };

    return (
        <Card
            className="cursor-pointer transition-all hover:shadow-surface hover:border-primary/40"
            onClick={onOpen}
        >
            <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="text-caption font-semibold truncate">{equipment.name}</p>
                        <p className="text-micro text-muted-foreground truncate">
                            {equipment.category}
                            {equipment.brand && ` · ${equipment.brand}`}
                            {equipment.model && ` ${equipment.model}`}
                        </p>
                    </div>
                    <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                            onClick={onEdit}
                            className="p-1 rounded hover:bg-surface-2"
                            aria-label="Modifier"
                        >
                            <Edit2 className="h-4 w-4 text-muted-foreground" />
                        </button>
                        <button
                            onClick={onDelete}
                            className="p-1 rounded hover:bg-destructive/10"
                            aria-label="Supprimer"
                        >
                            <Trash2 className="h-4 w-4 text-destructive" />
                        </button>
                    </div>
                </div>
                {equipment.location_room && (
                    <p className="text-micro text-muted-foreground">📍 {equipment.location_room}</p>
                )}
                {warrantyStatus && (
                    <span
                        className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-micro font-medium ${warrantyStatus.className}`}
                    >
                        <ShieldCheck className="h-3 w-3" />
                        {warrantyStatus.label}
                    </span>
                )}
            </CardContent>
        </Card>
    );
};

// ---------- Equipment detail (full-width dialog with timeline) ----------

const EquipmentDetailDialog: React.FC<{
    equipment: Equipment;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onEdit: () => void;
}> = ({ equipment, open, onOpenChange, onEdit }) => {
    const maintenanceQuery = useMaintenance({ equipment_id: equipment.id, status: 'all' });
    const updateMut = useUpdateMaintenance();
    const deleteMaintMut = useDeleteMaintenance();
    const [maintDialogOpen, setMaintDialogOpen] = useState(false);
    const [editingMaint, setEditingMaint] = useState<Maintenance | null>(null);

    const sorted = useMemo(() => {
        const items = maintenanceQuery.data ?? [];
        return [...items].sort((a, b) => {
            const aKey = a.planned_date ?? a.performed_date ?? '';
            const bKey = b.planned_date ?? b.performed_date ?? '';
            return bKey.localeCompare(aKey);
        });
    }, [maintenanceQuery.data]);

    const markPerformed = async (m: Maintenance) => {
        const today = new Date().toISOString().slice(0, 10);
        try {
            await updateMut.mutateAsync({ id: m.id, patch: { performed_date: today } });
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Erreur.');
        }
    };

    const handleDeleteMaintenance = async (m: Maintenance) => {
        if (!confirm(`Supprimer "${m.title}" ?`)) return;
        await deleteMaintMut.mutateAsync(m.id);
    };

    return (
        <>
            <Dialog
                open={open}
                onOpenChange={onOpenChange}
                title={equipment.name}
                description={`${equipment.category}${equipment.brand ? ` · ${equipment.brand}` : ''}${
                    equipment.model ? ` ${equipment.model}` : ''
                }`}
                className="sm:max-w-2xl"
            >
                <div className="space-y-6">
                    {/* Identity / warranty banner */}
                    <section className="rounded-card border border-border p-4 bg-surface-2/40 space-y-2">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-micro text-muted-foreground">
                            {equipment.serial_number && (
                                <div>
                                    <p className="font-medium text-foreground">N° série</p>
                                    <p className="truncate">{equipment.serial_number}</p>
                                </div>
                            )}
                            {equipment.purchase_date && (
                                <div>
                                    <p className="font-medium text-foreground">Acheté le</p>
                                    <p>{formatDate(equipment.purchase_date)}</p>
                                </div>
                            )}
                            {equipment.warranty_until && (
                                <div>
                                    <p className="font-medium text-foreground">Garantie</p>
                                    <p>{formatDate(equipment.warranty_until)}</p>
                                </div>
                            )}
                            {equipment.location_room && (
                                <div>
                                    <p className="font-medium text-foreground">Lieu</p>
                                    <p>{equipment.location_room}</p>
                                </div>
                            )}
                        </div>
                        {equipment.notes && (
                            <p className="text-micro italic text-muted-foreground border-t border-border pt-2">
                                {equipment.notes}
                            </p>
                        )}
                        <div className="flex justify-end">
                            <Button variant="ghost" size="sm" onClick={onEdit}>
                                <Edit2 className="h-4 w-4 mr-1.5" />
                                Modifier l'équipement
                            </Button>
                        </div>
                    </section>

                    {/* Maintenance timeline */}
                    <section>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-caption font-semibold flex items-center gap-2">
                                <Wrench className="h-4 w-4" />
                                Historique d'entretien
                            </h3>
                            <Button
                                size="sm"
                                onClick={() => {
                                    setEditingMaint(null);
                                    setMaintDialogOpen(true);
                                }}
                            >
                                <Plus className="h-4 w-4 mr-1.5" />
                                Entretien
                            </Button>
                        </div>
                        {maintenanceQuery.isPending ? (
                            <div className="text-caption text-muted-foreground py-4">
                                Chargement…
                            </div>
                        ) : sorted.length === 0 ? (
                            <p className="text-micro text-muted-foreground italic">
                                Aucun entretien renseigné.
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {sorted.map((m) => (
                                    <MaintenanceRow
                                        key={m.id}
                                        item={m}
                                        onMarkDone={() => markPerformed(m)}
                                        onEdit={() => {
                                            setEditingMaint(m);
                                            setMaintDialogOpen(true);
                                        }}
                                        onDelete={() => handleDeleteMaintenance(m)}
                                    />
                                ))}
                            </ul>
                        )}
                    </section>

                    {/* Phase 5: documents attached to this equipment (factures,
                    manuels, photos…) — uploaded via DocumentsList's own dialog. */}
                    <section>
                        <DocumentsList
                            entityType="equipment"
                            entityId={equipment.id}
                            entityLabel={equipment.name}
                            mode="full"
                        />
                    </section>
                </div>
            </Dialog>

            {/* Sibling, not child: nested Radix Dialogs steal each other's focus
            trap and the inner one becomes invisible / non-interactive. */}
            <MaintenanceDialog
                open={maintDialogOpen}
                onOpenChange={setMaintDialogOpen}
                equipment={equipment}
                maintenance={editingMaint}
            />
        </>
    );
};

// ---------- Entretiens (global tab) ----------

const MaintenanceTab: React.FC = () => {
    const [status, setStatus] = useState<'upcoming' | 'done' | 'all'>('upcoming');
    const maintenanceQuery = useMaintenance({ status });
    const updateMut = useUpdateMaintenance();
    const deleteMut = useDeleteMaintenance();

    const markPerformed = async (m: Maintenance) => {
        const today = new Date().toISOString().slice(0, 10);
        try {
            await updateMut.mutateAsync({ id: m.id, patch: { performed_date: today } });
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Erreur.');
        }
    };

    const handleDelete = async (m: Maintenance) => {
        if (!confirm(`Supprimer "${m.title}" ?`)) return;
        await deleteMut.mutateAsync(m.id);
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
                {(['upcoming', 'done', 'all'] as const).map((s) => (
                    <CategoryChip
                        key={s}
                        label={s === 'upcoming' ? 'À venir' : s === 'done' ? 'Réalisés' : 'Tous'}
                        active={status === s}
                        onClick={() => setStatus(s)}
                    />
                ))}
            </div>

            {maintenanceQuery.isPending ? (
                <div className="text-caption text-muted-foreground py-6 text-center">
                    Chargement…
                </div>
            ) : maintenanceQuery.isError ? (
                <ErrorBanner
                    message={
                        maintenanceQuery.error instanceof Error
                            ? maintenanceQuery.error.message
                            : 'Erreur'
                    }
                />
            ) : maintenanceQuery.data && maintenanceQuery.data.length > 0 ? (
                <ul className="space-y-2">
                    {maintenanceQuery.data.map((m) => (
                        <MaintenanceRow
                            key={m.id}
                            item={m}
                            showEquipment
                            onMarkDone={() => markPerformed(m)}
                            onDelete={() => handleDelete(m)}
                        />
                    ))}
                </ul>
            ) : (
                <EmptyState
                    title={
                        status === 'upcoming'
                            ? 'Aucun entretien à venir'
                            : status === 'done'
                              ? 'Aucun entretien réalisé'
                              : 'Aucun entretien'
                    }
                    description="Ajoute des entretiens depuis le détail d'un équipement."
                />
            )}
        </div>
    );
};

const MaintenanceRow: React.FC<{
    item: Maintenance;
    showEquipment?: boolean;
    onMarkDone: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
}> = ({ item, showEquipment, onMarkDone, onEdit, onDelete }) => {
    const isDone = !!item.performed_date;
    const isPlanned = !!item.planned_date && !isDone;
    const planDays = isPlanned ? daysUntil(item.planned_date!) : null;
    const overdue = planDays !== null && planDays < 0;

    return (
        <li className="rounded-card border border-border bg-card p-3">
            <div className="flex items-start gap-3">
                <div
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        isDone
                            ? 'bg-success-soft text-success'
                            : overdue
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-primary-soft text-primary'
                    }`}
                >
                    {isDone ? (
                        <CheckCircle2 className="h-4 w-4" />
                    ) : overdue ? (
                        <AlertCircle className="h-4 w-4" />
                    ) : (
                        <CalendarIcon className="h-4 w-4" />
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-caption font-semibold truncate">
                        {item.title}{' '}
                        <span className="text-micro text-muted-foreground font-normal">
                            · {item.kind}
                        </span>
                    </p>
                    <p className="text-micro text-muted-foreground">
                        {showEquipment && item.equipment_name && (
                            <span className="font-medium text-foreground">
                                {item.equipment_name}
                            </span>
                        )}
                        {showEquipment && item.equipment_name && ' — '}
                        {isDone ? (
                            <>Réalisé le {formatDate(item.performed_date)}</>
                        ) : isPlanned ? (
                            <>
                                Prévu le {formatDate(item.planned_date)}
                                {planDays !== null && (
                                    <span className={overdue ? 'text-destructive' : ''}>
                                        {' '}
                                        (
                                        {overdue
                                            ? `en retard de ${-planDays}j`
                                            : `dans ${planDays}j`}
                                        )
                                    </span>
                                )}
                            </>
                        ) : null}
                        {item.cost !== null && <> · {item.cost.toFixed(2)} €</>}
                        {item.recurrence_months && <> · récurrence {item.recurrence_months} mois</>}
                    </p>
                    {item.notes && (
                        <p className="text-micro italic text-muted-foreground mt-1">{item.notes}</p>
                    )}
                </div>
                <div className="flex gap-1 shrink-0">
                    {!isDone && (
                        <Button size="sm" variant="secondary" onClick={onMarkDone}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            Fait
                        </Button>
                    )}
                    {onEdit && (
                        <button
                            onClick={onEdit}
                            className="p-1 rounded hover:bg-surface-2"
                            aria-label="Modifier"
                        >
                            <Edit2 className="h-4 w-4 text-muted-foreground" />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={onDelete}
                            className="p-1 rounded hover:bg-destructive/10"
                            aria-label="Supprimer"
                        >
                            <Trash2 className="h-4 w-4 text-destructive" />
                        </button>
                    )}
                </div>
            </div>
        </li>
    );
};

// ---------- Factures / Contrats récurrents (Phase 2) ----------

const ContractsTab: React.FC = () => {
    const { showToast } = useToast();
    const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
    const contractsQuery = useContracts({ status });
    const deleteMut = useDeleteContract();
    const payMut = usePayContract();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Contract | null>(null);

    const handleDelete = async (c: Contract) => {
        if (!confirm(`Supprimer "${c.name}" ?`)) return;
        try {
            await deleteMut.mutateAsync(c.id);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Erreur.');
        }
    };

    const handlePay = async (c: Contract) => {
        const ok = confirm(
            `Marquer "${c.name}" payé ?\n\nProchaine échéance : +${frequencyLabel(c.frequency)}` +
                (c.auto_create_budget_entry
                    ? `\nUne dépense de ${c.amount.toFixed(2)} € sera ajoutée au Budget (catégorie : ${c.budget_category ?? 'Maison'}).`
                    : ''),
        );
        if (!ok) return;
        try {
            const result = await payMut.mutateAsync({ id: c.id });
            showToast({
                title: 'Paiement enregistré ✓',
                description: `Prochaine échéance : ${formatDate(result.contract.next_due_date)}${
                    result.budget_entry_id ? ' · dépense créée dans le Budget' : ''
                }`,
            });
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Erreur.');
        }
    };

    const monthlyTotal =
        contractsQuery.data?.reduce((sum, c) => {
            const months = FREQUENCY_MONTHS[c.frequency] ?? 0;
            return months > 0 ? sum + c.amount / months : sum;
        }, 0) ?? 0;

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                    {(['active', 'inactive', 'all'] as const).map((s) => (
                        <CategoryChip
                            key={s}
                            label={
                                s === 'active' ? 'Actifs' : s === 'inactive' ? 'Inactifs' : 'Tous'
                            }
                            active={status === s}
                            onClick={() => setStatus(s)}
                        />
                    ))}
                </div>
                <Button
                    onClick={() => {
                        setEditing(null);
                        setDialogOpen(true);
                    }}
                >
                    <Plus className="h-4 w-4 mr-2" />
                    Ajouter un contrat
                </Button>
            </div>

            {status === 'active' && contractsQuery.data && contractsQuery.data.length > 0 && (
                <div className="rounded-card border border-border bg-primary-soft/40 px-4 py-2 text-caption">
                    Coût mensuel estimé total :{' '}
                    <span className="font-semibold text-foreground">
                        {monthlyTotal.toFixed(2)} €
                    </span>
                </div>
            )}

            {contractsQuery.isPending ? (
                <SkeletonGrid />
            ) : contractsQuery.isError ? (
                <ErrorBanner
                    message={
                        contractsQuery.error instanceof Error
                            ? contractsQuery.error.message
                            : 'Erreur'
                    }
                />
            ) : contractsQuery.data && contractsQuery.data.length > 0 ? (
                <ul className="space-y-2">
                    {contractsQuery.data.map((c) => (
                        <ContractRow
                            key={c.id}
                            contract={c}
                            onPay={() => handlePay(c)}
                            onEdit={() => {
                                setEditing(c);
                                setDialogOpen(true);
                            }}
                            onDelete={() => handleDelete(c)}
                        />
                    ))}
                </ul>
            ) : (
                <EmptyState
                    title="Aucun contrat enregistré"
                    description="Ajoute tes abonnements et factures récurrents (EDF, internet, assurance, prêt…) pour suivre les échéances et générer automatiquement les dépenses dans le Budget."
                    actionLabel="Ajouter un contrat"
                    onAction={() => {
                        setEditing(null);
                        setDialogOpen(true);
                    }}
                />
            )}

            <ContractDialog open={dialogOpen} onOpenChange={setDialogOpen} contract={editing} />
        </div>
    );
};

// Mirrors the server-side FREQUENCY_MONTHS map. Used to compute the monthly
// estimated cost across all active contracts.
const FREQUENCY_MONTHS: Record<string, number> = {
    Mensuel: 1,
    Bimestriel: 2,
    Trimestriel: 3,
    Semestriel: 6,
    Annuel: 12,
};

const frequencyLabel = (freq: string): string => {
    const m = FREQUENCY_MONTHS[freq];
    if (!m) return freq;
    if (m === 1) return '1 mois';
    if (m < 12) return `${m} mois`;
    return '1 an';
};

const ContractRow: React.FC<{
    contract: Contract;
    onPay: () => void;
    onEdit: () => void;
    onDelete: () => void;
}> = ({ contract, onPay, onEdit, onDelete }) => {
    const due = daysUntil(contract.next_due_date);
    const overdue = due < 0;
    const dueSoon = due >= 0 && due <= 7;

    return (
        <li
            className={`rounded-card border bg-card p-3 ${
                overdue ? 'border-destructive/40' : dueSoon ? 'border-warning/40' : 'border-border'
            } ${!contract.is_active ? 'opacity-60' : ''}`}
        >
            <div className="flex items-start gap-3">
                <div
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-card ${
                        overdue
                            ? 'bg-destructive/10 text-destructive'
                            : dueSoon
                              ? 'bg-warning-soft text-warning'
                              : 'bg-primary-soft text-primary'
                    }`}
                >
                    <Receipt className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-caption font-semibold truncate">{contract.name}</p>
                        {contract.provider && (
                            <span className="text-micro text-muted-foreground">
                                · {contract.provider}
                            </span>
                        )}
                        <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-micro text-muted-foreground">
                            {contract.category}
                        </span>
                        <span className="text-micro inline-flex items-center gap-0.5 text-muted-foreground">
                            <Repeat className="h-3 w-3" />
                            {contract.frequency}
                        </span>
                        {!contract.is_active && (
                            <span className="rounded-pill bg-muted px-2 py-0.5 text-micro text-muted-foreground inline-flex items-center gap-1">
                                <Pause className="h-3 w-3" />
                                Inactif
                            </span>
                        )}
                    </div>
                    <p className="text-micro text-muted-foreground mt-0.5">
                        <span className="font-semibold text-foreground">
                            {contract.amount.toFixed(2)} €
                        </span>
                        {' · '}
                        Échéance {formatDate(contract.next_due_date)}
                        {contract.is_active && (
                            <span
                                className={
                                    overdue
                                        ? 'text-destructive font-medium'
                                        : dueSoon
                                          ? 'text-warning font-medium'
                                          : ''
                                }
                            >
                                {' '}
                                ({overdue ? `en retard de ${-due}j` : `dans ${due}j`})
                            </span>
                        )}
                        {contract.payment_method && <> · {contract.payment_method}</>}
                    </p>
                    {contract.notes && (
                        <p className="text-micro italic text-muted-foreground mt-1">
                            {contract.notes}
                        </p>
                    )}
                </div>
                <div className="flex gap-1 shrink-0 items-center">
                    {contract.is_active && (
                        <Button size="sm" variant="secondary" onClick={onPay}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            Payé
                        </Button>
                    )}
                    <button
                        onClick={onEdit}
                        className="p-1 rounded hover:bg-surface-2"
                        aria-label="Modifier"
                    >
                        <Edit2 className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button
                        onClick={onDelete}
                        className="p-1 rounded hover:bg-destructive/10"
                        aria-label="Supprimer"
                    >
                        <Trash2 className="h-4 w-4 text-destructive" />
                    </button>
                </div>
            </div>
        </li>
    );
};

// ---------- Contacts pro (Phase 3) ----------

const ContactsTab: React.FC = () => {
    const [category, setCategory] = useState<ContactCategory | 'all'>('all');
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const contactsQuery = useContacts({
        category: category === 'all' ? undefined : category,
        q: search || undefined,
    });
    const deleteMut = useDeleteContact();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Contact | null>(null);

    const onSubmitSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setSearch(searchInput.trim());
    };

    const handleDelete = async (c: Contact) => {
        if (!confirm(`Supprimer "${c.name}" ?`)) return;
        try {
            await deleteMut.mutateAsync(c.id);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Erreur.');
        }
    };

    // Group by category for the rendering — easier to scan than a flat list
    // when there are >5 contacts. Server already sorts favourites first
    // within each category.
    const grouped = (contactsQuery.data ?? []).reduce<Record<string, Contact[]>>((acc, c) => {
        (acc[c.category] ??= []).push(c);
        return acc;
    }, {});
    const orderedCategories = Object.keys(grouped).sort();

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <form
                    onSubmit={onSubmitSearch}
                    className="flex items-center gap-2 w-full md:max-w-md"
                >
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Rechercher (nom, société, notes)…"
                            className="pl-9"
                        />
                    </div>
                </form>
                <Button
                    onClick={() => {
                        setEditing(null);
                        setDialogOpen(true);
                    }}
                >
                    <Plus className="h-4 w-4 mr-2" />
                    Ajouter un contact
                </Button>
            </div>

            <div className="flex flex-wrap gap-2">
                <CategoryChip
                    label="Toutes"
                    active={category === 'all'}
                    onClick={() => setCategory('all')}
                />
                {CONTACT_CATEGORIES.map((c) => (
                    <CategoryChip
                        key={c}
                        label={c}
                        active={category === c}
                        onClick={() => setCategory(c)}
                    />
                ))}
            </div>

            {contactsQuery.isPending ? (
                <SkeletonGrid />
            ) : contactsQuery.isError ? (
                <ErrorBanner
                    message={
                        contactsQuery.error instanceof Error
                            ? contactsQuery.error.message
                            : 'Erreur'
                    }
                />
            ) : contactsQuery.data && contactsQuery.data.length > 0 ? (
                <div className="space-y-5">
                    {orderedCategories.map((cat) => (
                        <div key={cat} className="space-y-2">
                            <h3 className="text-caption font-semibold text-muted-foreground">
                                {cat}
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {grouped[cat].map((contact) => (
                                    <ContactCard
                                        key={contact.id}
                                        contact={contact}
                                        onEdit={() => {
                                            setEditing(contact);
                                            setDialogOpen(true);
                                        }}
                                        onDelete={() => handleDelete(contact)}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <EmptyState
                    title="Aucun contact enregistré"
                    description="Ajoute ton plombier, ton électricien, ton médecin, le gardien… tout ce que tu veux pouvoir appeler vite."
                    actionLabel="Ajouter un contact"
                    onAction={() => {
                        setEditing(null);
                        setDialogOpen(true);
                    }}
                />
            )}

            <ContactDialog open={dialogOpen} onOpenChange={setDialogOpen} contact={editing} />
        </div>
    );
};

const ContactCard: React.FC<{
    contact: Contact;
    onEdit: () => void;
    onDelete: () => void;
}> = ({ contact, onEdit, onDelete }) => (
    <div className="rounded-card border border-border bg-card p-3 space-y-2">
        <div className="flex items-start gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                <UserRound className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <p className="text-caption font-semibold truncate">{contact.name}</p>
                    {contact.is_favorite && (
                        <Star className="h-3.5 w-3.5 text-warning fill-warning shrink-0" />
                    )}
                </div>
                {contact.company && (
                    <p className="text-micro text-muted-foreground truncate">{contact.company}</p>
                )}
                {contact.equipment_name && (
                    <p className="text-micro text-muted-foreground truncate">
                        🔧 {contact.equipment_name}
                    </p>
                )}
            </div>
            <div className="flex gap-1 shrink-0">
                <button
                    onClick={onEdit}
                    className="p-1 rounded hover:bg-surface-2"
                    aria-label="Modifier"
                >
                    <Edit2 className="h-4 w-4 text-muted-foreground" />
                </button>
                <button
                    onClick={onDelete}
                    className="p-1 rounded hover:bg-destructive/10"
                    aria-label="Supprimer"
                >
                    <Trash2 className="h-4 w-4 text-destructive" />
                </button>
            </div>
        </div>
        <div className="space-y-1">
            {contact.phone && (
                <a
                    href={`tel:${contact.phone}`}
                    className="flex items-center gap-2 text-micro text-primary hover:underline"
                >
                    <Phone className="h-3.5 w-3.5" />
                    {contact.phone}
                </a>
            )}
            {contact.email && (
                <a
                    href={`mailto:${contact.email}`}
                    className="flex items-center gap-2 text-micro text-primary hover:underline truncate"
                >
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{contact.email}</span>
                </a>
            )}
            {contact.address && (
                <p className="flex items-start gap-2 text-micro text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{contact.address}</span>
                </p>
            )}
            {contact.last_intervention_date && (
                <p className="text-micro text-muted-foreground italic">
                    Dernière intervention : {formatDate(contact.last_intervention_date)}
                </p>
            )}
            {contact.notes && (
                <p className="text-micro italic text-muted-foreground line-clamp-2 border-l-2 border-border pl-2">
                    {contact.notes}
                </p>
            )}
        </div>
    </div>
);

// ---------- Rangement (Phase 4) ----------

const StorageTab: React.FC = () => {
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [selectedRoomId, setSelectedRoomId] = useState<string | 'orphan' | null>(null);
    const [roomDialogOpen, setRoomDialogOpen] = useState(false);
    const [editingRoom, setEditingRoom] = useState<Room | null>(null);
    const [itemDialogOpen, setItemDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<HouseItem | null>(null);

    const roomsQuery = useRooms();
    const deleteRoomMut = useDeleteRoom();
    const deleteItemMut = useDeleteItem();

    // Three modes for the items panel:
    //   - search active → cross-room search results
    //   - selectedRoomId set → single-room drill-in
    //   - selectedRoomId null & no search → recent items across the foyer
    const itemFilters = search
        ? { q: search }
        : selectedRoomId === 'orphan'
          ? { orphan: true }
          : selectedRoomId
            ? { room_id: selectedRoomId }
            : {};
    const itemsQuery = useItems(itemFilters);

    const onSubmitSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const q = searchInput.trim();
        setSearch(q);
        if (q) setSelectedRoomId(null);
    };

    const handleDeleteRoom = async (room: Room) => {
        const itemsCount = room.items_count ?? 0;
        const msg =
            itemsCount > 0
                ? `Supprimer "${room.name}" ?\n\n${itemsCount} objet(s) ne seront plus rattachés à une pièce (visible sous "À ranger").`
                : `Supprimer "${room.name}" ?`;
        if (!confirm(msg)) return;
        try {
            await deleteRoomMut.mutateAsync(room.id);
            if (selectedRoomId === room.id) setSelectedRoomId(null);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Erreur.');
        }
    };

    const handleDeleteItem = async (item: HouseItem) => {
        if (!confirm(`Supprimer "${item.name}" ?`)) return;
        await deleteItemMut.mutateAsync(item.id);
    };

    const rooms = roomsQuery.data ?? [];
    const items = itemsQuery.data ?? [];

    return (
        <div className="space-y-5">
            {/* "Où est X ?" search bar — most-used path. */}
            <form onSubmit={onSubmitSearch} className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Où est… ? (ex: tournevis, passeport, chargeur)"
                        className="pl-9 text-base"
                    />
                </div>
                {(search || selectedRoomId) && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setSearch('');
                            setSearchInput('');
                            setSelectedRoomId(null);
                        }}
                    >
                        Réinitialiser
                    </Button>
                )}
            </form>

            {/* Rooms */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-caption font-semibold flex items-center gap-2">
                        <DoorOpen className="h-4 w-4" />
                        Pièces ({rooms.length})
                    </h3>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                setEditingRoom(null);
                                setRoomDialogOpen(true);
                            }}
                        >
                            <Plus className="h-4 w-4 mr-1.5" />
                            Pièce
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => {
                                setEditingItem(null);
                                setItemDialogOpen(true);
                            }}
                        >
                            <Plus className="h-4 w-4 mr-1.5" />
                            Objet
                        </Button>
                    </div>
                </div>

                {roomsQuery.isPending ? (
                    <SkeletonGrid />
                ) : rooms.length === 0 ? (
                    <EmptyState
                        title="Aucune pièce enregistrée"
                        description='Commence par créer "Salon", "Cuisine", "Garage"… puis ajoute-y tes objets.'
                        actionLabel="Ajouter une pièce"
                        onAction={() => {
                            setEditingRoom(null);
                            setRoomDialogOpen(true);
                        }}
                    />
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {rooms.map((r) => (
                            <RoomCard
                                key={r.id}
                                room={r}
                                active={selectedRoomId === r.id}
                                onClick={() => {
                                    setSelectedRoomId(selectedRoomId === r.id ? null : r.id);
                                    setSearch('');
                                    setSearchInput('');
                                }}
                                onEdit={() => {
                                    setEditingRoom(r);
                                    setRoomDialogOpen(true);
                                }}
                                onDelete={() => handleDeleteRoom(r)}
                            />
                        ))}
                        {/* "À ranger" virtual room: surfaces orphan items
                            (room deleted, or never assigned). */}
                        <button
                            type="button"
                            onClick={() => {
                                setSelectedRoomId(selectedRoomId === 'orphan' ? null : 'orphan');
                                setSearch('');
                                setSearchInput('');
                            }}
                            className={`rounded-card border-2 border-dashed p-3 text-left transition-all ${
                                selectedRoomId === 'orphan'
                                    ? 'border-warning/50 bg-warning-soft'
                                    : 'border-border bg-muted/20 hover:bg-muted/30'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <PackageOpen className="h-4 w-4 text-warning" />
                                <p className="text-caption font-semibold">À ranger</p>
                            </div>
                            <p className="text-micro text-muted-foreground mt-1">
                                Objets sans pièce
                            </p>
                        </button>
                    </div>
                )}
            </section>

            {/* Items panel: title varies with the active filter so the user
                always knows what they're looking at. */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-caption font-semibold flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        {search
                            ? `Résultats pour "${search}"`
                            : selectedRoomId === 'orphan'
                              ? 'Objets sans pièce'
                              : selectedRoomId
                                ? `Objets dans "${rooms.find((r) => r.id === selectedRoomId)?.name ?? ''}"`
                                : 'Tous les objets'}
                        {items.length > 0 && (
                            <span className="text-micro text-muted-foreground font-normal">
                                ({items.length})
                            </span>
                        )}
                    </h3>
                </div>

                {itemsQuery.isPending ? (
                    <div className="text-caption text-muted-foreground py-4">Chargement…</div>
                ) : items.length === 0 ? (
                    <div className="rounded-card border border-dashed border-border bg-muted/20 p-6 text-center">
                        <p className="text-caption font-medium">
                            {search ? 'Aucun résultat.' : 'Aucun objet pour ce filtre.'}
                        </p>
                        <p className="text-micro text-muted-foreground mt-1">
                            {search
                                ? "Essaie un mot plus court ou vérifie l'orthographe."
                                : 'Ajoute des objets pour les retrouver plus tard.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {items.map((item) => (
                            <ItemCard
                                key={item.id}
                                item={item}
                                onEdit={() => {
                                    setEditingItem(item);
                                    setItemDialogOpen(true);
                                }}
                                onDelete={() => handleDeleteItem(item)}
                            />
                        ))}
                    </div>
                )}
            </section>

            <RoomDialog open={roomDialogOpen} onOpenChange={setRoomDialogOpen} room={editingRoom} />
            <ItemDialog
                open={itemDialogOpen}
                onOpenChange={setItemDialogOpen}
                item={editingItem}
                defaultRoomId={
                    !editingItem &&
                    typeof selectedRoomId === 'string' &&
                    selectedRoomId !== 'orphan'
                        ? selectedRoomId
                        : null
                }
            />
        </div>
    );
};

const RoomCard: React.FC<{
    room: Room;
    active: boolean;
    onClick: () => void;
    onEdit: () => void;
    onDelete: () => void;
}> = ({ room, active, onClick, onEdit, onDelete }) => (
    <div
        className={`group rounded-card border-2 p-3 cursor-pointer transition-all ${
            active ? 'shadow-surface' : 'border-border hover:shadow-surface'
        }`}
        style={active ? { borderColor: room.color, background: `${room.color}10` } : undefined}
        onClick={onClick}
    >
        <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 flex items-center gap-2">
                <span
                    className="inline-block h-3 w-3 rounded-full shrink-0"
                    style={{ background: room.color }}
                />
                <p className="text-caption font-semibold truncate">{room.name}</p>
            </div>
            <div
                className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={onEdit}
                    className="p-0.5 rounded hover:bg-surface-2"
                    aria-label="Modifier"
                >
                    <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <button
                    onClick={onDelete}
                    className="p-0.5 rounded hover:bg-destructive/10"
                    aria-label="Supprimer"
                >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </button>
            </div>
        </div>
        <p className="text-micro text-muted-foreground mt-1">
            {room.category}
            {' · '}
            {room.items_count ?? 0} objet{(room.items_count ?? 0) > 1 ? 's' : ''}
        </p>
    </div>
);

const ItemCard: React.FC<{
    item: HouseItem;
    onEdit: () => void;
    onDelete: () => void;
}> = ({ item, onEdit, onDelete }) => (
    <div className="rounded-card border border-border bg-card p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
                <p className="text-caption font-semibold truncate">
                    {item.name}
                    {item.quantity && item.quantity > 1 && (
                        <span className="ml-1.5 text-micro text-muted-foreground font-normal">
                            × {item.quantity}
                        </span>
                    )}
                </p>
                <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-micro text-muted-foreground inline-block mt-0.5">
                    {item.category}
                </span>
            </div>
            <div className="flex gap-1 shrink-0">
                <button
                    onClick={onEdit}
                    className="p-1 rounded hover:bg-surface-2"
                    aria-label="Modifier"
                >
                    <Edit2 className="h-4 w-4 text-muted-foreground" />
                </button>
                <button
                    onClick={onDelete}
                    className="p-1 rounded hover:bg-destructive/10"
                    aria-label="Supprimer"
                >
                    <Trash2 className="h-4 w-4 text-destructive" />
                </button>
            </div>
        </div>
        <div className="space-y-1 text-micro text-muted-foreground">
            {item.room_name ? (
                <p className="flex items-center gap-1">
                    <span
                        className="inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ background: item.room_color || '#999' }}
                    />
                    <span className="font-medium text-foreground">{item.room_name}</span>
                    {item.location_detail && (
                        <>
                            <ArrowRight className="h-3 w-3" />
                            <span className="truncate">{item.location_detail}</span>
                        </>
                    )}
                </p>
            ) : (
                <p className="flex items-center gap-1 text-warning">
                    <PackageOpen className="h-3 w-3" />À ranger
                </p>
            )}
            {item.notes && (
                <p className="italic line-clamp-2 border-l-2 border-border pl-2">{item.notes}</p>
            )}
        </div>
    </div>
);

// ---------- Documents (Phase 5) ----------

const DocumentsTab: React.FC = () => {
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<DocumentCategory | 'all'>('all');
    const [scope, setScope] = useState<'all' | 'unlinked'>('all');
    const [uploadOpen, setUploadOpen] = useState(false);

    const docsQuery = useDocuments({
        category: category === 'all' ? undefined : category,
        q: search || undefined,
        unlinked: scope === 'unlinked' ? true : undefined,
    });
    const deleteMut = useDeleteDocument();

    const onSubmitSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setSearch(searchInput.trim());
    };

    const handleDelete = async (doc: HouseDocument) => {
        if (!confirm(`Supprimer "${doc.name}" ?\nLe fichier sera définitivement effacé.`)) return;
        await deleteMut.mutateAsync(doc.id);
    };

    const docs = docsQuery.data ?? [];

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <form
                    onSubmit={onSubmitSearch}
                    className="flex items-center gap-2 w-full md:max-w-md"
                >
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Rechercher (nom, fichier, notes)…"
                            className="pl-9"
                        />
                    </div>
                </form>
                <Button onClick={() => setUploadOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Ajouter un document
                </Button>
            </div>

            <div className="flex flex-wrap gap-2">
                <CategoryChip
                    label="Toutes"
                    active={category === 'all' && scope === 'all'}
                    onClick={() => {
                        setCategory('all');
                        setScope('all');
                    }}
                />
                {DOCUMENT_CATEGORIES.map((c) => (
                    <CategoryChip
                        key={c}
                        label={c}
                        active={category === c}
                        onClick={() => {
                            setCategory(c);
                            setScope('all');
                        }}
                    />
                ))}
                <CategoryChip
                    label="Sans lien"
                    active={scope === 'unlinked'}
                    onClick={() => {
                        setScope('unlinked');
                        setCategory('all');
                    }}
                />
            </div>

            {docsQuery.isPending ? (
                <SkeletonGrid />
            ) : docsQuery.isError ? (
                <ErrorBanner
                    message={docsQuery.error instanceof Error ? docsQuery.error.message : 'Erreur'}
                />
            ) : docs.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {docs.map((doc) => (
                        <DocumentLibraryCard
                            key={doc.id}
                            doc={doc}
                            onDelete={() => handleDelete(doc)}
                        />
                    ))}
                </div>
            ) : (
                <EmptyState
                    title="Aucun document"
                    description="Upload tes premières factures, contrats, manuels ou photos."
                    actionLabel="Ajouter un document"
                    onAction={() => setUploadOpen(true)}
                />
            )}

            <DocumentUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
        </div>
    );
};

// Card variant used by the standalone library tab — same structure as
// DocumentsList's full mode but with an extra "lien" hint at the bottom.
const DocumentLibraryCard: React.FC<{ doc: HouseDocument; onDelete: () => void }> = ({
    doc,
    onDelete,
}) => {
    const Icon = isPdf(doc.mime_type)
        ? FileText
        : isPreviewableImage(doc.mime_type)
          ? FileText
          : FileText;
    const isImage = isPreviewableImage(doc.mime_type);
    const linkLabel = doc.equipment_id
        ? '🔧 Équipement'
        : doc.contract_id
          ? '📄 Contrat'
          : doc.contact_id
            ? '👤 Contact'
            : doc.item_id
              ? '📦 Objet'
              : doc.project_id
                ? '🏗️ Projet'
                : 'Sans lien';
    return (
        <div className="rounded-card border border-border bg-card overflow-hidden">
            {isImage ? (
                <a
                    href={documentFileUrl(doc.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block h-32 bg-surface-2"
                >
                    <img
                        src={documentFileUrl(doc.id)}
                        alt={doc.name}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                    />
                </a>
            ) : (
                <a
                    href={documentFileUrl(doc.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-32 items-center justify-center bg-surface-2 hover:bg-surface-2/80"
                >
                    <Icon className="h-12 w-12 text-muted-foreground" />
                </a>
            )}
            <div className="p-3 space-y-1">
                <p className="text-caption font-semibold truncate">{doc.name}</p>
                <p className="text-micro text-muted-foreground truncate">
                    {doc.category} · {formatFileSize(doc.file_size)}
                </p>
                <p className="text-micro text-muted-foreground truncate">{linkLabel}</p>
                <div className="flex gap-1 pt-1">
                    <a
                        href={documentFileUrl(doc.id, { download: true })}
                        className="p-1 rounded hover:bg-surface-2 text-muted-foreground"
                        aria-label="Télécharger"
                    >
                        <FolderOpen className="h-4 w-4" />
                    </a>
                    <button
                        onClick={onDelete}
                        className="ml-auto p-1 rounded hover:bg-destructive/10 text-destructive"
                        aria-label="Supprimer"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};

// ---------- Projets travaux (Phase 5) ----------

const ProjectsTab: React.FC = () => {
    const [status, setStatus] = useState<ProjectStatus | 'all'>('all');
    const projectsQuery = useProjects(status === 'all' ? undefined : { status });
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Project | null>(null);
    const [detailFor, setDetailFor] = useState<Project | null>(null);

    const projects = projectsQuery.data ?? [];

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                    <CategoryChip
                        label="Tous"
                        active={status === 'all'}
                        onClick={() => setStatus('all')}
                    />
                    {PROJECT_STATUSES.map((s) => (
                        <CategoryChip
                            key={s}
                            label={s}
                            active={status === s}
                            onClick={() => setStatus(s)}
                        />
                    ))}
                </div>
                <Button
                    onClick={() => {
                        setEditing(null);
                        setDialogOpen(true);
                    }}
                >
                    <Plus className="h-4 w-4 mr-2" />
                    Nouveau projet
                </Button>
            </div>

            {projectsQuery.isPending ? (
                <SkeletonGrid />
            ) : projects.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {projects.map((p) => (
                        <ProjectCard
                            key={p.id}
                            project={p}
                            onClick={() => setDetailFor(p)}
                            onEdit={() => {
                                setEditing(p);
                                setDialogOpen(true);
                            }}
                        />
                    ))}
                </div>
            ) : (
                <EmptyState
                    title="Aucun projet"
                    description="Refaire la cuisine, repeindre le couloir, planter le jardin… ajoute ton premier projet pour le suivre du début à la fin."
                    actionLabel="Nouveau projet"
                    onAction={() => {
                        setEditing(null);
                        setDialogOpen(true);
                    }}
                />
            )}

            <ProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} project={editing} />

            {detailFor && (
                <ProjectDetailDialog
                    project={detailFor}
                    open={!!detailFor}
                    onOpenChange={(open) => !open && setDetailFor(null)}
                    onEdit={() => {
                        setEditing(detailFor);
                        setDialogOpen(true);
                    }}
                />
            )}
        </div>
    );
};

const ProjectCard: React.FC<{
    project: Project;
    onClick: () => void;
    onEdit: () => void;
}> = ({ project, onClick, onEdit }) => {
    // Status badge palette centralised in colorPresets.ts so a future
    // status (e.g., "Annulé") can be added in one place.
    const statusBadge = PROJECT_STATUS_COLORS[project.status] ?? {
        bg: 'bg-surface-2',
        text: 'text-muted-foreground',
    };
    const statusColor = `${statusBadge.bg} ${statusBadge.text}`;
    const checklistDone = project.checklist.filter((i) => i.done).length;
    const checklistTotal = project.checklist.length;
    return (
        <Card
            className="cursor-pointer transition-all hover:shadow-surface hover:border-primary/40"
            onClick={onClick}
        >
            <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                        <p className="text-caption font-semibold truncate">{project.name}</p>
                        <p className="text-micro text-muted-foreground truncate">
                            {project.category}
                        </p>
                    </div>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit();
                        }}
                        className="p-1 rounded hover:bg-surface-2 shrink-0"
                        aria-label="Modifier"
                    >
                        <Edit2 className="h-4 w-4 text-muted-foreground" />
                    </button>
                </div>
                <div className="flex items-center gap-2 text-micro">
                    <span className={`rounded-pill px-2 py-0.5 font-medium ${statusColor}`}>
                        {project.status}
                    </span>
                    {project.planned_budget !== null && (
                        <span className="text-muted-foreground">
                            Budget : {project.planned_budget.toFixed(0)} €
                        </span>
                    )}
                </div>
                {checklistTotal > 0 && (
                    <div className="space-y-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                            <div
                                className="h-full bg-primary transition-all"
                                style={{
                                    width: `${(checklistDone / checklistTotal) * 100}%`,
                                }}
                            />
                        </div>
                        <p className="text-micro text-muted-foreground">
                            {checklistDone}/{checklistTotal} tâches
                        </p>
                    </div>
                )}
                {(project.documents_count ?? 0) > 0 && (
                    <p className="text-micro text-muted-foreground inline-flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {project.documents_count} document
                        {(project.documents_count ?? 0) > 1 ? 's' : ''}
                    </p>
                )}
            </CardContent>
        </Card>
    );
};

const ProjectDetailDialog: React.FC<{
    project: Project;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onEdit: () => void;
}> = ({ project, open, onOpenChange, onEdit }) => {
    const updateProject = useUpdateProject();
    const deleteProject = useDeleteProject();
    const checklistMut = useUpdateProjectChecklist();
    const [newItemLabel, setNewItemLabel] = useState('');

    const handleStatusChange = async (next: ProjectStatus) => {
        await updateProject.mutateAsync({
            id: project.id,
            patch: {
                status: next,
                completed_at: next === 'Terminé' ? new Date().toISOString().slice(0, 10) : null,
            },
        });
    };

    const handleAddItem = async (e: React.FormEvent) => {
        e.preventDefault();
        const label = newItemLabel.trim();
        if (!label) return;
        await checklistMut.mutateAsync({
            projectId: project.id,
            op: { op: 'add', label },
        });
        setNewItemLabel('');
    };

    const handleToggle = (id: string) =>
        checklistMut.mutate({ projectId: project.id, op: { op: 'toggle', id } });

    const handleRemoveItem = (id: string) =>
        checklistMut.mutate({ projectId: project.id, op: { op: 'remove', id } });

    const handleDelete = async () => {
        if (
            !confirm(
                `Supprimer "${project.name}" ?\nLes documents associés ne seront pas supprimés (ils deviennent "Sans lien").`,
            )
        )
            return;
        await deleteProject.mutateAsync(project.id);
        onOpenChange(false);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={project.name}
            description={`${project.category} · ${project.status}`}
            className="sm:max-w-2xl"
        >
            <div className="space-y-5">
                {/* Status quick switcher */}
                <div className="flex flex-wrap gap-2">
                    {PROJECT_STATUSES.map((s) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => handleStatusChange(s)}
                            className={`rounded-pill border px-3 py-1 text-micro font-medium transition-colors ${
                                project.status === s
                                    ? 'bg-primary text-white border-primary'
                                    : 'bg-card text-foreground border-border hover:bg-surface-2'
                            }`}
                        >
                            {s}
                        </button>
                    ))}
                </div>

                {/* Meta */}
                {(project.description ||
                    project.planned_budget !== null ||
                    project.started_at ||
                    project.target_end) && (
                    <section className="rounded-card border border-border p-4 bg-surface-2/40 space-y-2 text-micro text-muted-foreground">
                        {project.description && (
                            <p className="text-caption text-foreground">{project.description}</p>
                        )}
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {project.planned_budget !== null && (
                                <span>
                                    <span className="font-medium text-foreground">
                                        Budget prévu :
                                    </span>{' '}
                                    {project.planned_budget.toFixed(2)} €
                                </span>
                            )}
                            {project.started_at && (
                                <span>
                                    <span className="font-medium text-foreground">Début :</span>{' '}
                                    {formatDate(project.started_at)}
                                </span>
                            )}
                            {project.target_end && (
                                <span>
                                    <span className="font-medium text-foreground">Cible :</span>{' '}
                                    {formatDate(project.target_end)}
                                </span>
                            )}
                            {project.completed_at && (
                                <span>
                                    <span className="font-medium text-foreground">Terminé :</span>{' '}
                                    {formatDate(project.completed_at)}
                                </span>
                            )}
                        </div>
                        {project.notes && (
                            <p className="italic border-t border-border pt-2">{project.notes}</p>
                        )}
                    </section>
                )}

                {/* Checklist */}
                <section>
                    <h3 className="text-caption font-semibold mb-2 flex items-center gap-2">
                        <CheckSquare className="h-4 w-4" />
                        Checklist
                        {project.checklist.length > 0 && (
                            <span className="text-micro text-muted-foreground font-normal">
                                ({project.checklist.filter((i) => i.done).length}/
                                {project.checklist.length})
                            </span>
                        )}
                    </h3>
                    {project.checklist.length === 0 ? (
                        <p className="text-micro text-muted-foreground italic mb-2">
                            Aucune tâche. Décompose ton projet en petits pas.
                        </p>
                    ) : (
                        <ul className="space-y-1.5 mb-2">
                            {project.checklist.map((item) => (
                                <li
                                    key={item.id}
                                    className="flex items-center gap-2 rounded-input border border-border bg-card px-2 py-1.5 group"
                                >
                                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />
                                    <button
                                        type="button"
                                        onClick={() => handleToggle(item.id)}
                                        className="shrink-0"
                                        aria-label={item.done ? 'Décocher' : 'Cocher'}
                                    >
                                        {item.done ? (
                                            <CheckSquare className="h-4 w-4 text-primary" />
                                        ) : (
                                            <Square className="h-4 w-4 text-muted-foreground" />
                                        )}
                                    </button>
                                    <span
                                        className={`flex-1 text-caption ${
                                            item.done ? 'text-muted-foreground line-through' : ''
                                        }`}
                                    >
                                        {item.label}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveItem(item.id)}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10"
                                        aria-label="Supprimer"
                                    >
                                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <form onSubmit={handleAddItem} className="flex gap-2">
                        <Input
                            value={newItemLabel}
                            onChange={(e) => setNewItemLabel(e.target.value)}
                            placeholder="Ajouter une tâche…"
                            disabled={project.checklist.length >= 30}
                        />
                        <Button
                            type="submit"
                            size="sm"
                            disabled={!newItemLabel.trim() || project.checklist.length >= 30}
                        >
                            <Plus className="h-4 w-4" />
                        </Button>
                    </form>
                    {project.checklist.length >= 30 && (
                        <p className="text-micro text-muted-foreground italic mt-1">
                            Maximum 30 tâches — découpe en sous-projets.
                        </p>
                    )}
                </section>

                {/* Documents */}
                <section>
                    <DocumentsList
                        entityType="project"
                        entityId={project.id}
                        entityLabel={project.name}
                        mode="full"
                    />
                </section>

                {/* Actions */}
                <div className="flex justify-between pt-2 border-t border-border">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDelete}
                        className="text-destructive"
                    >
                        <Trash2 className="h-4 w-4 mr-1.5" />
                        Supprimer
                    </Button>
                    <Button variant="secondary" size="sm" onClick={onEdit}>
                        <Edit2 className="h-4 w-4 mr-1.5" />
                        Modifier
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};

// ---------- Helpers ----------

const SkeletonGrid: React.FC = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
            <div key={i} className="h-28 rounded-card bg-surface-2 animate-pulse" />
        ))}
    </div>
);

const EmptyState: React.FC<{
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
}> = ({ title, description, actionLabel, onAction }) => (
    <div className="rounded-card border border-dashed border-border bg-muted/20 p-6 text-center">
        <HistoryIcon className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-caption font-medium">{title}</p>
        <p className="text-micro text-muted-foreground mt-1">{description}</p>
        {actionLabel && onAction && (
            <Button onClick={onAction} className="mt-3" size="sm">
                <Plus className="h-4 w-4 mr-1.5" />
                {actionLabel}
            </Button>
        )}
    </div>
);

const ErrorBanner: React.FC<{ message: string }> = ({ message }) => (
    <div className="rounded-input border border-destructive/30 bg-destructive/10 px-3 py-2 text-caption text-destructive flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        {message}
    </div>
);

export default House;
