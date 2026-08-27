import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryClient';

// =============================================================================
// House care program hooks — profile, seasonal tasks, completion logs, and the
// three AI endpoints (annual plan, weekly briefing, symptom diagnosis).
//
// Same shape as useHouse: <Type> interfaces → useXxx queries → mutations that
// invalidate. The AI mutations deliberately don't invalidate anything: they
// return proposals and advice, never writes. The plan lands in the DB only when
// the user accepts it, through useCreateCareTasksBulk.
// =============================================================================

export const CARE_CATEGORIES = [
    'Toiture',
    'Extérieur',
    'Fondation',
    'Plomberie',
    'Chauffage & ventilation',
    'Électricité',
    'Sécurité',
    'Intérieur',
    'Gros postes',
] as const;
export type CareCategory = (typeof CARE_CATEGORIES)[number];

export const CARE_SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver', "Toute l'année"] as const;
export type CareSeason = (typeof CARE_SEASONS)[number];

export const CARE_FREQUENCIES = [
    'Hebdomadaire',
    'Mensuel',
    'Trimestriel',
    'Saisonnier',
    'Annuel',
    'Pluriannuel',
] as const;
export type CareFrequency = (typeof CARE_FREQUENCIES)[number];

export const CARE_PRIORITIES = ['Critique', 'Important', 'Confort'] as const;
export type CarePriority = (typeof CARE_PRIORITIES)[number];

export const CARE_RESPONSIBILITIES = ['Soi-même', 'Professionnel', 'Mixte'] as const;
export type CareResponsibility = (typeof CARE_RESPONSIBILITIES)[number];

export const CARE_LOG_STATUSES = ['Fait', 'Ignoré', 'Problème'] as const;
export type CareLogStatus = (typeof CARE_LOG_STATUSES)[number];

export const DWELLING_TYPES = [
    'Unifamiliale',
    'Jumelé',
    'Maison en rangée',
    'Plain-pied',
    'Condo',
    'Chalet',
    'Autre',
] as const;
export type DwellingType = (typeof DWELLING_TYPES)[number];

export const CLIMATE_ZONES = [
    'Continental humide (hivers rigoureux)',
    'Tempéré océanique',
    'Méditerranéen',
    'Tropical / chaud',
] as const;
export type ClimateZone = (typeof CLIMATE_ZONES)[number];

export const HEATING_TYPES = [
    'Thermopompe',
    'Plinthes électriques',
    'Fournaise à air chaud',
    'Chaudière (eau chaude)',
    'Gaz naturel',
    'Mazout',
    'Poêle à bois',
    'Foyer',
    'Géothermie',
    'Autre',
] as const;
export type HeatingType = (typeof HEATING_TYPES)[number];

export const ROOF_TYPES = [
    'Bardeaux d’asphalte',
    'Tôle / métal',
    'Membrane élastomère',
    'Toit plat gravier',
    'Tuiles',
    'Autre',
] as const;

export interface HouseProfile {
    dwelling_type: DwellingType;
    build_year: number | null;
    living_area_m2: number | null;
    occupants: number | null;
    climate_zone: ClimateZone;
    has_basement: boolean;
    basement_finished: boolean;
    has_sump_pump: boolean;
    has_garage: boolean;
    has_pool: boolean;
    has_septic: boolean;
    has_well: boolean;
    has_irrigation: boolean;
    has_air_exchanger: boolean;
    heating_types: HeatingType[];
    roof_type: string | null;
    roof_year: number | null;
    water_heater_year: number | null;
    windows_year: number | null;
    siding_type: string | null;
    property_value: number | null;
    notes: string | null;
    exists: boolean;
}

export interface CareTask {
    id: string;
    title: string;
    category: CareCategory;
    season: CareSeason;
    frequency: CareFrequency;
    interval_months: number | null;
    month_start: number | null;
    month_end: number | null;
    priority: CarePriority;
    responsibility: CareResponsibility;
    estimated_minutes: number | null;
    estimated_cost: number | null;
    risk_if_skipped: string | null;
    steps: string[];
    equipment_id: string | null;
    source: 'catalog' | 'ai' | 'manual';
    catalog_key: string | null;
    is_active: boolean;
    last_done_on: string | null;
    next_due_on: string | null;
    equipment_name?: string;
    /** Only present in the overview's weekly checklist. */
    done_this_week?: boolean;
}

export interface CareTaskDetail extends CareTask {
    history: CareLog[];
}

export interface CareLog {
    id: string;
    task_id: string;
    done_on: string;
    status: CareLogStatus;
    minutes_spent: number | null;
    cost: number | null;
    observation: string | null;
    task_title?: string;
    task_category?: string;
}

export interface BigTicketItem {
    key: string;
    label: string;
    installed_year: number;
    expected_year: number;
    years_left: number;
    estimated_cost: number;
    yearly_provision: number;
}

export interface CareOverview {
    season: CareSeason;
    month: number;
    profile: HouseProfile;
    weekly_checklist: CareTask[];
    overdue: CareTask[];
    due_soon: CareTask[];
    season_tasks: CareTask[];
    recent_issues: CareLog[];
    big_ticket: BigTicketItem[];
    suggested_yearly_budget: number | null;
    counts: {
        total: number;
        weekly: number;
        weekly_done: number;
        overdue: number;
        overdue_critical: number;
        due_soon: number;
        season: number;
    };
}

export type CareTaskInput = Omit<
    CareTask,
    | 'id'
    | 'source'
    | 'catalog_key'
    | 'last_done_on'
    | 'equipment_name'
    | 'done_this_week'
    | 'is_active'
> & { is_active?: boolean };

const invalidateCare = (qc: ReturnType<typeof useQueryClient>) => {
    qc.invalidateQueries({ queryKey: queryKeys.houseCare.all });
    // The house dashboard card surfaces care counts too.
    qc.invalidateQueries({ queryKey: queryKeys.house.all });
};

// ---------- Profile ----------

export const useHouseProfile = () =>
    useQuery({
        queryKey: queryKeys.houseCare.profile(),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: HouseProfile }>(
                '/api/house/care/profile',
            );
            return r.data;
        },
    });

export const useSaveHouseProfile = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (patch: Partial<HouseProfile>) => {
            const r = await api.put<{ success: boolean; data: HouseProfile }>(
                '/api/house/care/profile',
                patch,
            );
            return r.data;
        },
        onSuccess: () => invalidateCare(qc),
    });
};

// ---------- Tasks ----------

export interface CareTaskFilters {
    // Index signature so the filters object can be handed straight to the
    // query-key builder, which is generic over Record<string, unknown>.
    [key: string]: unknown;
    season?: CareSeason;
    category?: CareCategory;
    frequency?: CareFrequency;
    priority?: CarePriority;
    status?: 'all' | 'due' | 'overdue' | 'week' | 'season';
    search?: string;
    include_inactive?: boolean;
}

const toQueryString = (filters?: CareTaskFilters): string => {
    if (!filters) return '';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
        if (value === undefined || value === '' || value === null) continue;
        params.set(key, String(value));
    }
    const s = params.toString();
    return s ? `?${s}` : '';
};

export const useCareTasks = (filters?: CareTaskFilters) =>
    useQuery({
        queryKey: queryKeys.houseCare.tasks(filters),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: CareTask[] }>(
                `/api/house/care/tasks${toQueryString(filters)}`,
            );
            return r.data;
        },
    });

export const useCareTask = (id: string | null) =>
    useQuery({
        queryKey: queryKeys.houseCare.task(id ?? ''),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: CareTaskDetail }>(
                `/api/house/care/tasks/${id}`,
            );
            return r.data;
        },
        enabled: Boolean(id),
    });

export const useCareOverview = () =>
    useQuery({
        queryKey: queryKeys.houseCare.overview(),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: CareOverview }>(
                '/api/house/care/overview',
            );
            return r.data;
        },
    });

export const useCreateCareTask = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: Partial<CareTaskInput>) => {
            const r = await api.post<{ success: boolean; data: CareTask }>(
                '/api/house/care/tasks',
                body,
            );
            return r.data;
        },
        onSuccess: () => invalidateCare(qc),
    });
};

/** Accepting an AI plan: creates every reviewed task in one transaction. */
export const useCreateCareTasksBulk = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (tasks: Array<Partial<CareTaskInput>>) => {
            const r = await api.post<{ success: boolean; data: CareTask[] }>(
                '/api/house/care/tasks/bulk',
                { tasks, source: 'ai' },
            );
            return r.data;
        },
        onSuccess: () => invalidateCare(qc),
    });
};

export const useUpdateCareTask = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, patch }: { id: string; patch: Partial<CareTaskInput> }) => {
            const r = await api.patch<{ success: boolean; data: CareTask }>(
                `/api/house/care/tasks/${id}`,
                patch,
            );
            return r.data;
        },
        onSuccess: () => invalidateCare(qc),
    });
};

export const useDeleteCareTask = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/api/house/care/tasks/${id}`);
            return id;
        },
        onSuccess: () => invalidateCare(qc),
    });
};

export interface CompleteCarePayload {
    done_on?: string;
    status?: CareLogStatus;
    minutes_spent?: number | null;
    cost?: number | null;
    observation?: string | null;
    keep_schedule?: boolean;
}

export const useCompleteCareTask = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, body }: { id: string; body?: CompleteCarePayload }) => {
            const r = await api.post<{ success: boolean; data: CareTask }>(
                `/api/house/care/tasks/${id}/complete`,
                body ?? {},
            );
            return r.data;
        },
        onSuccess: () => invalidateCare(qc),
    });
};

export const useCareLogs = (filters?: {
    task_id?: string;
    status?: CareLogStatus;
    limit?: number;
}) =>
    useQuery({
        queryKey: queryKeys.houseCare.logs(filters),
        queryFn: async () => {
            const params = new URLSearchParams();
            if (filters?.task_id) params.set('task_id', filters.task_id);
            if (filters?.status) params.set('status', filters.status);
            if (filters?.limit) params.set('limit', String(filters.limit));
            const qs = params.toString();
            const r = await api.get<{ success: boolean; data: CareLog[] }>(
                `/api/house/care/logs${qs ? `?${qs}` : ''}`,
            );
            return r.data;
        },
    });

export interface SeedResult {
    created: CareTask[];
    created_count: number;
    applicable_count: number;
    skipped_count: number;
}

/** Install the curated baseline program for this house. Idempotent. */
export const useSeedCarePlan = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (options?: { reset?: boolean }) => {
            const r = await api.post<{ success: boolean; data: SeedResult }>(
                '/api/house/care/seed',
                { reset: options?.reset ?? false },
            );
            return r.data;
        },
        onSuccess: () => invalidateCare(qc),
    });
};

// ---------- AI ----------

export interface CarePlanTask {
    title: string;
    category: CareCategory;
    season: CareSeason;
    frequency: CareFrequency;
    intervalMonths: number | null;
    monthStart: number | null;
    monthEnd: number | null;
    priority: CarePriority;
    responsibility: CareResponsibility;
    estimatedMinutes: number | null;
    estimatedCost: number | null;
    riskIfSkipped: string;
    steps: string[];
}

export interface HouseCarePlan {
    summary: string;
    tasks: CarePlanTask[];
    priorities: Array<{ title: string; why: string; when: string }>;
    budget: { yearlyProvision: number | null; rationale: string };
    watchouts: string[];
}

export const useGenerateCarePlan = () =>
    useMutation({
        mutationFn: async (body?: { season?: CareSeason; focus?: string }) => {
            const r = await api.post<{
                success: boolean;
                data: { plan: HouseCarePlan; model: string };
            }>('/api/ai/house/care-plan', body ?? {});
            return r.data;
        },
    });

export interface WeeklyBriefing {
    headline: string;
    summary: string;
    focus: Array<{ title: string; why: string; when: string; minutes: number | null }>;
    quickChecks: Array<{ label: string; detail: string }>;
    weatherAlerts: Array<{ level: 'info' | 'attention' | 'urgent'; message: string }>;
    encouragement: string;
}

export const useGenerateWeeklyBriefing = () =>
    useMutation({
        mutationFn: async (body?: { includeWeather?: boolean }) => {
            const r = await api.post<{
                success: boolean;
                data: { briefing: WeeklyBriefing; model: string; weatherUsed: boolean };
            }>('/api/ai/house/weekly-briefing', body ?? {});
            return r.data;
        },
    });

export interface HouseDiagnosis {
    summary: string;
    urgency: 'Immédiat' | 'Cette semaine' | 'À surveiller';
    urgencyReason: string;
    likelyCauses: Array<{
        cause: string;
        likelihood: 'Probable' | 'Possible' | 'Moins probable';
        explanation: string;
        howToConfirm: string;
    }>;
    immediateActions: string[];
    callAPro: boolean;
    proType: string | null;
    questionsForPro: string[];
    estimatedCostRange: string | null;
    redFlags: string[];
    preventiveTasks: string[];
}

export const useDiagnoseHouse = () =>
    useMutation({
        mutationFn: async (body: { symptom: string; location?: string; since?: string }) => {
            const r = await api.post<{
                success: boolean;
                data: { diagnosis: HouseDiagnosis; model: string };
            }>('/api/ai/house/diagnose', body);
            return r.data;
        },
    });

// ---------- Presentation helpers ----------

/** Days until (positive) or since (negative) a due date. */
export const daysUntilDue = (due: string | null): number | null => {
    if (!due) return null;
    const target = new Date(`${due}T12:00:00`).getTime();
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return Math.round((target - today.getTime()) / 86_400_000);
};

export const priorityVariant = (
    priority: CarePriority,
): 'danger' | 'warning' | 'secondary' | 'default' => {
    if (priority === 'Critique') return 'danger';
    if (priority === 'Important') return 'warning';
    return 'secondary';
};
