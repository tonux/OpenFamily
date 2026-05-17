import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryClient';

// =============================================================================
// House data hooks (Phase 1: equipments + maintenance + dashboard aggregator).
// Same shape as useShopping: <Type> interfaces → useXxx queries → useCreate /
// useUpdate / useDelete mutations that invalidate the right keys.
// =============================================================================

export const EQUIPMENT_CATEGORIES = [
    'Chaudière',
    'Climatisation',
    'Électroménager',
    'Véhicule',
    'Outillage',
    'Sécurité',
    'Jardin',
    'Autre',
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const MAINTENANCE_KINDS = ['Entretien', 'Révision', 'Réparation', 'Inspection'] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export interface Equipment {
    id: string;
    name: string;
    category: EquipmentCategory;
    brand: string | null;
    model: string | null;
    serial_number: string | null;
    purchase_date: string | null;
    purchase_price: number | null;
    warranty_until: string | null;
    location_room: string | null;
    image_url: string | null;
    notes: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface EquipmentDetail extends Equipment {
    recent_maintenance: Maintenance[];
    upcoming_count: number;
}

export interface Maintenance {
    id: string;
    equipment_id: string;
    title: string;
    kind: MaintenanceKind;
    planned_date: string | null;
    performed_date: string | null;
    cost: number | null;
    recurrence_months: number | null;
    notes: string | null;
    created_at?: string;
    updated_at?: string;
    equipment_name?: string;
    equipment_category?: string;
}

export const CONTRACT_CATEGORIES = [
    'Énergie',
    'Eau',
    'Internet',
    'Téléphone',
    'Streaming',
    'Assurance',
    'Prêt',
    'Abonnement',
    'Autre',
] as const;
export type ContractCategory = (typeof CONTRACT_CATEGORIES)[number];

export const CONTRACT_FREQUENCIES = [
    'Mensuel',
    'Bimestriel',
    'Trimestriel',
    'Semestriel',
    'Annuel',
] as const;
export type ContractFrequency = (typeof CONTRACT_FREQUENCIES)[number];

export const PAYMENT_METHODS = [
    'Prélèvement auto',
    'Carte',
    'Virement',
    'Chèque',
    'Espèces',
    'Manuel',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface Contract {
    id: string;
    name: string;
    provider: string | null;
    category: ContractCategory;
    amount: number;
    frequency: ContractFrequency;
    next_due_date: string;
    payment_method: PaymentMethod | null;
    client_number: string | null;
    notes: string | null;
    is_active: boolean;
    auto_create_budget_entry: boolean;
    budget_category: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface HouseDashboard {
    upcoming_maintenance: Maintenance[];
    expiring_warranties: Array<{
        id: string;
        name: string;
        category: string;
        warranty_until: string;
    }>;
    upcoming_contracts: Contract[];
    monthly_estimated_total: number;
    counts: {
        equipments: number;
        upcoming_30d: number;
        warranties_60d: number;
        active_contracts: number;
        contracts_due_7d: number;
    };
}

// ---------- Equipment queries ----------

export const useEquipments = (filters?: { category?: EquipmentCategory; q?: string }) =>
    useQuery({
        queryKey: queryKeys.house.equipments(filters),
        queryFn: async () => {
            const params = new URLSearchParams();
            if (filters?.category) params.set('category', filters.category);
            if (filters?.q) params.set('q', filters.q);
            const suffix = params.toString();
            const r = await api.get<{ success: boolean; data: Equipment[] }>(
                `/api/house/equipments${suffix ? `?${suffix}` : ''}`,
            );
            return r.data;
        },
    });

export const useEquipment = (id: string | null) =>
    useQuery({
        queryKey: queryKeys.house.equipment(id ?? '__none__'),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: EquipmentDetail }>(
                `/api/house/equipments/${id}`,
            );
            return r.data;
        },
        enabled: !!id,
    });

// ---------- Maintenance queries ----------

export const useMaintenance = (filters?: {
    equipment_id?: string;
    status?: 'upcoming' | 'done' | 'all';
}) =>
    useQuery({
        queryKey: queryKeys.house.maintenance(filters),
        queryFn: async () => {
            const params = new URLSearchParams();
            if (filters?.equipment_id) params.set('equipment_id', filters.equipment_id);
            if (filters?.status) params.set('status', filters.status);
            const suffix = params.toString();
            const r = await api.get<{ success: boolean; data: Maintenance[] }>(
                `/api/house/maintenance${suffix ? `?${suffix}` : ''}`,
            );
            return r.data;
        },
    });

export const useHouseDashboard = () =>
    useQuery({
        queryKey: queryKeys.house.dashboard(),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: HouseDashboard }>(
                '/api/house/dashboard',
            );
            return r.data;
        },
        // Dashboard is read often (every render of /); 1 min keeps it fresh
        // without thrashing.
        staleTime: 60_000,
    });

// ---------- Mutations ----------

const invalidateHouse = (qc: ReturnType<typeof useQueryClient>) => {
    qc.invalidateQueries({ queryKey: queryKeys.house.all });
};

export const useCreateEquipment = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (
            body: Partial<Equipment> & { name: string; category: EquipmentCategory },
        ) => {
            const r = await api.post<{ success: boolean; data: Equipment }>(
                '/api/house/equipments',
                body,
            );
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useUpdateEquipment = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, patch }: { id: string; patch: Partial<Equipment> }) => {
            const r = await api.patch<{ success: boolean; data: Equipment }>(
                `/api/house/equipments/${id}`,
                patch,
            );
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useDeleteEquipment = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/house/equipments/${id}`);
            return id;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useCreateMaintenance = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (
            body: Partial<Maintenance> & {
                equipment_id: string;
                title: string;
                kind: MaintenanceKind;
            },
        ) => {
            const r = await api.post<{ success: boolean; data: Maintenance }>(
                '/api/house/maintenance',
                body,
            );
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useUpdateMaintenance = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, patch }: { id: string; patch: Partial<Maintenance> }) => {
            const r = await api.patch<{
                success: boolean;
                data: Maintenance & { next_occurrence: Maintenance | null };
            }>(`/api/house/maintenance/${id}`, patch);
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useDeleteMaintenance = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/house/maintenance/${id}`);
            return id;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

// ---------- Contract queries & mutations (Phase 2) ----------

export const useContracts = (filters?: { status?: 'active' | 'inactive' | 'all' }) =>
    useQuery({
        queryKey: queryKeys.house.contracts(filters),
        queryFn: async () => {
            const params = new URLSearchParams();
            if (filters?.status) params.set('status', filters.status);
            const suffix = params.toString();
            const r = await api.get<{ success: boolean; data: Contract[] }>(
                `/api/house/contracts${suffix ? `?${suffix}` : ''}`,
            );
            return r.data;
        },
    });

export const useCreateContract = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (
            body: Partial<Contract> & {
                name: string;
                category: ContractCategory;
                amount: number;
                frequency: ContractFrequency;
                next_due_date: string;
            },
        ) => {
            const r = await api.post<{ success: boolean; data: Contract }>(
                '/api/house/contracts',
                body,
            );
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useUpdateContract = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, patch }: { id: string; patch: Partial<Contract> }) => {
            const r = await api.patch<{ success: boolean; data: Contract }>(
                `/api/house/contracts/${id}`,
                patch,
            );
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useDeleteContract = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/house/contracts/${id}`);
            return id;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

interface PayContractInput {
    id: string;
    body?: {
        paid_date?: string;
        amount_actual?: number;
        create_budget_entry?: boolean;
    };
}

export const usePayContract = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, body }: PayContractInput) => {
            const r = await api.post<{
                success: boolean;
                data: {
                    contract: Contract;
                    budget_entry_id: string | null;
                    amount_paid: number;
                };
            }>(`/api/house/contracts/${id}/pay`, body ?? {});
            return r.data;
        },
        onSuccess: () => {
            invalidateHouse(qc);
            // The pay action may have written to budget_entries; if a Budget
            // page query is open it should refetch.
            qc.invalidateQueries({ queryKey: ['budget'] });
            qc.invalidateQueries({ queryKey: ['dashboard'] });
        },
    });
};

// ---------- Contacts (Phase 3) ----------

export const CONTACT_CATEGORIES = [
    'Plombier',
    'Électricien',
    'Chauffagiste',
    'Bricoleur',
    'Jardinier',
    'Ménage',
    'Médecin',
    'Pédiatre',
    'Vétérinaire',
    'Gardien',
    'Voisin',
    'Famille',
    'Urgences',
    'Assurance',
    'Banque',
    'École',
    'Autre',
] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

export interface Contact {
    id: string;
    name: string;
    category: ContactCategory;
    company: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
    last_intervention_date: string | null;
    is_favorite: boolean;
    equipment_id: string | null;
    equipment_name: string | null;
    created_at?: string;
    updated_at?: string;
}

export const useContacts = (filters?: {
    category?: ContactCategory;
    q?: string;
    equipment_id?: string;
}) =>
    useQuery({
        queryKey: queryKeys.house.contacts(filters),
        queryFn: async () => {
            const params = new URLSearchParams();
            if (filters?.category) params.set('category', filters.category);
            if (filters?.q) params.set('q', filters.q);
            if (filters?.equipment_id) params.set('equipment_id', filters.equipment_id);
            const suffix = params.toString();
            const r = await api.get<{ success: boolean; data: Contact[] }>(
                `/api/house/contacts${suffix ? `?${suffix}` : ''}`,
            );
            return r.data;
        },
    });

export const useCreateContact = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (
            body: Partial<Contact> & { name: string; category: ContactCategory },
        ) => {
            const r = await api.post<{ success: boolean; data: Contact }>(
                '/api/house/contacts',
                body,
            );
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useUpdateContact = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, patch }: { id: string; patch: Partial<Contact> }) => {
            const r = await api.patch<{ success: boolean; data: Contact }>(
                `/api/house/contacts/${id}`,
                patch,
            );
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useDeleteContact = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/house/contacts/${id}`);
            return id;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

// ---------- Rooms & Items (Phase 4) ----------

// Suggested categories — the API accepts any short string so users can type
// their own ("Grenier nord", "Cabane jardin", "Mezzanine"…) when the
// suggestion list doesn't fit their home.
export const ROOM_CATEGORIES = [
    'Salon',
    'Cuisine',
    'Salle à manger',
    'Chambre',
    'Chambre enfant',
    'Chambre sous sol',
    'Salle de bain',
    'WC',
    'Bureau',
    'Buanderie',
    'Garage',
    'Cave',
    'Grenier',
    'Atelier',
    'Jardin',
    'Terrasse',
    'Couloir',
    'Entrée',
    'Autre',
] as const;
export type RoomCategory = string;

export const ITEM_CATEGORIES = [
    'Outils',
    'Documents',
    'Médicaments',
    'Meubles',
    'Électronique',
    'Papeterie',
    'Vêtements',
    'Cuisine',
    'Décoration',
    'Jouets',
    'Sport',
    'Saisonnier',
    'Autre',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export interface Room {
    id: string;
    name: string;
    category: RoomCategory;
    color: string;
    notes: string | null;
    items_count?: number;
    created_at?: string;
    updated_at?: string;
}

export interface HouseItem {
    id: string;
    name: string;
    category: ItemCategory;
    room_id: string | null;
    room_name: string | null;
    room_color: string | null;
    quantity: number | null;
    location_detail: string | null;
    photo_url: string | null;
    notes: string | null;
    created_at?: string;
    updated_at?: string;
}

export const useRooms = () =>
    useQuery({
        queryKey: queryKeys.house.rooms(),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: Room[] }>('/api/house/rooms');
            return r.data;
        },
    });

export const useCreateRoom = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: Partial<Room> & { name: string; category: RoomCategory }) => {
            const r = await api.post<{ success: boolean; data: Room }>('/api/house/rooms', body);
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useUpdateRoom = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, patch }: { id: string; patch: Partial<Room> }) => {
            const r = await api.patch<{ success: boolean; data: Room }>(
                `/api/house/rooms/${id}`,
                patch,
            );
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useDeleteRoom = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/house/rooms/${id}`);
            return id;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useItems = (filters?: {
    room_id?: string;
    category?: ItemCategory;
    q?: string;
    orphan?: boolean;
}) =>
    useQuery({
        queryKey: queryKeys.house.items(filters),
        queryFn: async () => {
            const params = new URLSearchParams();
            if (filters?.room_id) params.set('room_id', filters.room_id);
            if (filters?.category) params.set('category', filters.category);
            if (filters?.q) params.set('q', filters.q);
            if (filters?.orphan !== undefined) params.set('orphan', String(filters.orphan));
            const suffix = params.toString();
            const r = await api.get<{ success: boolean; data: HouseItem[] }>(
                `/api/house/items${suffix ? `?${suffix}` : ''}`,
            );
            return r.data;
        },
    });

export const useCreateItem = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: Partial<HouseItem> & { name: string; category: ItemCategory }) => {
            const r = await api.post<{ success: boolean; data: HouseItem }>(
                '/api/house/items',
                body,
            );
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useUpdateItem = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, patch }: { id: string; patch: Partial<HouseItem> }) => {
            const r = await api.patch<{ success: boolean; data: HouseItem }>(
                `/api/house/items/${id}`,
                patch,
            );
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useDeleteItem = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/house/items/${id}`);
            return id;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useMoveItems = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ ids, room_id }: { ids: string[]; room_id: string | null }) => {
            const r = await api.post<{ success: boolean; data: { moved: number } }>(
                '/api/house/items/move',
                { ids, room_id },
            );
            return r.data.moved;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

// ---------- Projects (Phase 5) ----------

export const PROJECT_CATEGORIES = [
    'Rénovation',
    'Décoration',
    'Jardin',
    'Sécurité',
    'Confort',
    'Réparation',
    'Énergie',
    'Mobilier',
    'Autre',
] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export const PROJECT_STATUSES = ['Idée', 'En cours', 'Terminé', 'Suspendu'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface ChecklistItem {
    id: string;
    label: string;
    done: boolean;
}

export interface Project {
    id: string;
    name: string;
    category: ProjectCategory;
    status: ProjectStatus;
    description: string | null;
    planned_budget: number | null;
    started_at: string | null;
    target_end: string | null;
    completed_at: string | null;
    checklist: ChecklistItem[];
    notes: string | null;
    documents_count?: number;
    created_at?: string;
    updated_at?: string;
}

export const useProjects = (filters?: { status?: ProjectStatus }) =>
    useQuery({
        queryKey: queryKeys.house.projects(filters),
        queryFn: async () => {
            const params = new URLSearchParams();
            if (filters?.status) params.set('status', filters.status);
            const suffix = params.toString();
            const r = await api.get<{ success: boolean; data: Project[] }>(
                `/api/house/projects${suffix ? `?${suffix}` : ''}`,
            );
            return r.data;
        },
    });

export const useProject = (id: string | null) =>
    useQuery({
        queryKey: queryKeys.house.project(id ?? '__none__'),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: Project }>(
                `/api/house/projects/${id}`,
            );
            return r.data;
        },
        enabled: !!id,
    });

export const useCreateProject = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (
            body: Partial<Project> & {
                name: string;
                category: ProjectCategory;
            },
        ) => {
            const r = await api.post<{ success: boolean; data: Project }>(
                '/api/house/projects',
                body,
            );
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useUpdateProject = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, patch }: { id: string; patch: Partial<Project> }) => {
            const r = await api.patch<{ success: boolean; data: Project }>(
                `/api/house/projects/${id}`,
                patch,
            );
            return r.data;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

export const useDeleteProject = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/house/projects/${id}`);
            return id;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};

// Atomic checklist mutation. Op shape mirrors the server zod union; the
// caller passes one op at a time and gets back the full updated list so
// React Query can update the cached project record.
type ChecklistOp =
    | { op: 'add'; label: string }
    | { op: 'toggle'; id: string }
    | { op: 'rename'; id: string; label: string }
    | { op: 'remove'; id: string }
    | { op: 'reorder'; ids: string[] };

export const useUpdateProjectChecklist = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ projectId, op }: { projectId: string; op: ChecklistOp }) => {
            const r = await api.patch<{
                success: boolean;
                data: { checklist: ChecklistItem[] };
            }>(`/api/house/projects/${projectId}/checklist`, op);
            return r.data.checklist;
        },
        onSuccess: () => invalidateHouse(qc),
    });
};
