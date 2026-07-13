import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AlertTriangle,
    Camera,
    Check,
    Info,
    Loader2,
    ScanLine,
    Sprout,
    X as CloseIcon,
} from 'lucide-react';
import { Button, DatePicker, Dialog, Input, Select, Textarea, useToast } from '../ui';
import {
    GARDEN_CARE_TYPES,
    GARDEN_HEALTH_STATUSES,
    GARDEN_PLANT_TYPES,
    GARDEN_SUN_EXPOSURES,
    GARDEN_ZONE_TYPES,
    useCreateCare,
    useCreateObservation,
    useCreatePlant,
    useCreateZone,
    type GardenCareType,
    type GardenHealthStatus,
    type GardenPlantType,
    type GardenScan,
    type GardenScanMode,
    type GardenSunExposure,
    type GardenZone,
    type GardenZoneType,
} from '../../hooks/useGarden';

// =============================================================================
// "Scanner une photo" — turns a photo into a pre-filled Garden form.
//
// The server (POST /api/ai/garden/scan-photo) only ever PROPOSES: it reads the
// photo and returns a zone / plants / care tasks / journal entry, and writes
// nothing. This dialog renders that proposal as an editable, opt-in-per-item
// form; the user's confirmation is what calls the regular /api/garden endpoints.
//
// That split is deliberate. Vision is reliable on visible symptoms (and so on
// health status and the action to take) but not on cultivars — letting it write
// straight to the journal would quietly fill the garden log with plausible
// fiction, which is worse than no scan at all.
//
// The photo itself is never uploaded to storage: it's sent to the model, used,
// and dropped. Nothing here touches photo_url.
// =============================================================================

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_SIZE_MB = 5;

/** Sentinel for the zone <Select>: "create the zone the model proposed". */
const NEW_ZONE = '__new__';

const CONFIDENCE_STYLE: Record<GardenScan['confidence'], string> = {
    high: 'bg-success/15 text-success border border-success/30',
    medium: 'bg-warning/15 text-warning border border-warning/30',
    low: 'bg-danger/15 text-danger border border-danger/30',
};

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const isoInDays = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
};

// -- Upload ----------------------------------------------------------------
// XHR rather than fetch, mirroring DocumentUploadDialog/ReceiptScanDialog: it's
// the only way to keep the door open for a progress bar on slow mobile uploads.

type UploadErrorKind = 'http' | 'network' | 'abort';
interface UploadError extends Error {
    kind: UploadErrorKind;
    status?: number;
    code?: string;
    serverMessage?: string;
}

const uploadScan = (
    file: File,
    params: { mode: GardenScanMode; zoneId?: string },
): Promise<GardenScan> =>
    new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/api/ai/garden/scan-photo`);
        xhr.withCredentials = true;
        xhr.responseType = 'json';

        const fail = (kind: UploadErrorKind, extra: Partial<UploadError> = {}) =>
            reject(Object.assign(new Error(kind), { kind, ...extra }) as UploadError);

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.success) {
                resolve(xhr.response.data.scan as GardenScan);
                return;
            }
            const errorBody = xhr.response?.error;
            const code = typeof errorBody === 'object' ? errorBody?.code : undefined;
            const serverMessage =
                typeof errorBody === 'object' ? errorBody?.message : (errorBody as string);
            fail('http', { status: xhr.status, code, serverMessage });
        });
        xhr.addEventListener('error', () => fail('network'));
        xhr.addEventListener('abort', () => fail('abort'));

        const fd = new FormData();
        fd.append('file', file, file.name);
        fd.append('mode', params.mode);
        if (params.zoneId) fd.append('zoneId', params.zoneId);
        xhr.send(fd);
    });

// -- Editable review rows --------------------------------------------------

interface PlantRow {
    include: boolean;
    name: string;
    plant_type: GardenPlantType;
    variety: string | null;
    health_status: GardenHealthStatus;
    watering_frequency_days: number | null;
}

interface CareRow {
    include: boolean;
    care_type: GardenCareType;
    title: string;
    planned_date: string;
    recurrence_days: number | null;
    notes: string | null;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** 'plant' from the Plants tab, 'zone' from the Zones tab. Fixes the prompt used. */
    mode: GardenScanMode;
    zones: GardenZone[];
    /** Pre-selects a zone (plant mode) so the advice is tailored to the spot. */
    defaultZoneId?: string;
}

export const GardenScanDialog: React.FC<Props> = ({
    open,
    onOpenChange,
    mode,
    zones,
    defaultZoneId,
}) => {
    const { t } = useTranslation();
    const { showToast } = useToast();

    const createZone = useCreateZone();
    const createPlant = useCreatePlant();
    const createCare = useCreateCare();
    const createObservation = useCreateObservation();

    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [scanning, setScanning] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [scan, setScan] = useState<GardenScan | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Review state — seeded from the scan, then owned by the user.
    const [zoneChoice, setZoneChoice] = useState('');
    const [zoneName, setZoneName] = useState('');
    const [zoneType, setZoneType] = useState<GardenZoneType>('Potager');
    const [zoneSun, setZoneSun] = useState<GardenSunExposure | ''>('');
    const [plantRows, setPlantRows] = useState<PlantRow[]>([]);
    const [careRows, setCareRows] = useState<CareRow[]>([]);
    const [obsInclude, setObsInclude] = useState(false);
    const [obsNotes, setObsNotes] = useState('');
    const [obsHealth, setObsHealth] = useState<GardenHealthStatus | ''>('');

    const localizeUploadError = (err: unknown): string => {
        const e = err as UploadError | undefined;
        if (e?.kind === 'network') return t('garden.scan.errors.network');
        if (e?.kind === 'abort') return t('garden.scan.errors.aborted');
        if (e?.kind === 'http') {
            if (e.code === 'DISABLED') return t('garden.scan.errors.disabled');
            if (e.code === 'QUOTA_EXCEEDED') return t('garden.scan.errors.quota_exceeded');
            if (e.code === 'BAD_JSON') return t('garden.scan.errors.bad_json');
            return e.serverMessage || t('garden.scan.errors.scan_http', { status: e.status ?? '' });
        }
        return t('garden.scan.errors.scan_failed');
    };

    useEffect(() => {
        if (!file) {
            setPreviewUrl(null);
            return;
        }
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    // Reset on close so reopening starts from a blank slate.
    useEffect(() => {
        if (open) return;
        setFile(null);
        setError('');
        setScan(null);
        setScanning(false);
        setSaving(false);
        setPlantRows([]);
        setCareRows([]);
        setObsInclude(false);
    }, [open]);

    useEffect(() => {
        if (open) setZoneChoice(defaultZoneId ?? '');
    }, [open, defaultZoneId]);

    const handleFileChosen = (f: File | undefined | null) => {
        setError('');
        setScan(null);
        if (!f) {
            setFile(null);
            return;
        }
        if (!ALLOWED_MIME.includes(f.type)) {
            setError(
                t('garden.scan.errors.unsupported_format', {
                    type: f.type || t('garden.scan.errors.unknown_type'),
                }),
            );
            return;
        }
        if (f.size > MAX_SIZE_MB * 1024 * 1024) {
            setError(t('garden.scan.errors.too_large', { size: MAX_SIZE_MB }));
            return;
        }
        setFile(f);
    };

    /** Seeds the editable form from the model's proposal. */
    const applyScanToForm = (result: GardenScan) => {
        if (result.zone) {
            setZoneName(result.zone.name);
            setZoneType(result.zone.zone_type);
            setZoneSun(result.zone.sun_exposure ?? '');
        }
        // Zone mode defaults to creating the proposed zone; plant mode keeps
        // whichever existing zone the user was already filtering on.
        if (result.mode === 'zone' && result.zone) setZoneChoice(NEW_ZONE);

        setPlantRows(result.plants.map((p) => ({ include: true, ...p })));
        setCareRows(
            result.care.map((c) => ({
                include: true,
                care_type: c.care_type,
                title: c.title,
                planned_date: isoInDays(c.due_in_days),
                recurrence_days: c.recurrence_days,
                notes: c.notes,
            })),
        );
        setObsInclude(!!result.observation);
        setObsNotes(result.observation?.notes ?? '');
        setObsHealth(result.observation?.health_status ?? '');
    };

    const runScan = async () => {
        if (!file) return;
        setError('');
        setScanning(true);
        setScan(null);
        try {
            const result = await uploadScan(file, {
                mode,
                // Only meaningful in plant mode; an existing-zone pick sharpens the advice.
                zoneId:
                    mode === 'plant' && zoneChoice && zoneChoice !== NEW_ZONE
                        ? zoneChoice
                        : undefined,
            });
            setScan(result);
            applyScanToForm(result);
        } catch (err) {
            console.error('Garden scan failed:', err);
            setError(localizeUploadError(err));
        } finally {
            setScanning(false);
        }
    };

    const selectedPlants = plantRows.filter((p) => p.include && p.name.trim());
    const selectedCare = careRows.filter((c) => c.include && c.title.trim());

    const creatingZone = zoneChoice === NEW_ZONE && !!zoneName.trim();
    // The journal needs something to hang off: the API rejects an observation
    // with neither zone_id nor plant_id.
    const canAttachObservation = creatingZone || !!zoneChoice || selectedPlants.length > 0;

    const nothingSelected =
        selectedPlants.length === 0 &&
        selectedCare.length === 0 &&
        !creatingZone &&
        !(obsInclude && canAttachObservation);

    const zoneOptions = [
        { value: '', label: t('garden.common.none') },
        ...(scan?.zone
            ? [
                  {
                      value: NEW_ZONE,
                      label: t('garden.scan.createProposedZone', {
                          name: zoneName || scan.zone.name,
                      }),
                  },
              ]
            : []),
        ...zones.map((z) => ({ value: z.id, label: z.name })),
    ];

    const updatePlant = (i: number, patch: Partial<PlantRow>) =>
        setPlantRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

    const updateCare = (i: number, patch: Partial<CareRow>) =>
        setCareRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

    /**
     * Creates the confirmed rows through the regular endpoints, in FK order:
     * zone → plants → care → observation. There is no transactional endpoint, so
     * a mid-way failure leaves earlier rows in place; we say so rather than
     * pretending the whole thing rolled back.
     */
    const save = async () => {
        setError('');
        setSaving(true);
        let createdSomething = false;
        try {
            let zoneId: string | null = null;
            if (creatingZone) {
                const zone = await createZone.mutateAsync({
                    name: zoneName.trim(),
                    zone_type: zoneType,
                    sun_exposure: zoneSun || null,
                    notes: scan?.zone?.notes || null,
                });
                zoneId = zone.id;
                createdSomething = true;
            } else if (zoneChoice && zoneChoice !== NEW_ZONE) {
                zoneId = zoneChoice;
            }

            const plantIds: string[] = [];
            for (const p of selectedPlants) {
                const plant = await createPlant.mutateAsync({
                    name: p.name.trim(),
                    plant_type: p.plant_type,
                    zone_id: zoneId,
                    variety: p.variety?.trim() || null,
                    planted_date: null,
                    watering_frequency_days: p.watering_frequency_days,
                    health_status: p.health_status,
                    notes: null,
                });
                plantIds.push(plant.id);
                createdSomething = true;
            }

            // In plant mode the scan describes ONE plant, so care and the journal
            // entry hang off it. In zone mode they describe the area as a whole and
            // hang off the zone — attaching a zone-wide note to one arbitrary plant
            // would misfile it.
            const primaryPlantId = mode === 'plant' ? (plantIds[0] ?? null) : null;

            for (const c of selectedCare) {
                await createCare.mutateAsync({
                    title: c.title.trim(),
                    care_type: c.care_type,
                    zone_id: zoneId,
                    plant_id: primaryPlantId,
                    planned_date: c.planned_date || todayISO(),
                    recurrence_days: c.recurrence_days,
                    notes: c.notes?.trim() || null,
                });
                createdSomething = true;
            }

            if (obsInclude && obsNotes.trim() && (primaryPlantId || zoneId)) {
                await createObservation.mutateAsync({
                    // Both keys are allowed; the plant one also refreshes the plant's
                    // health_status server-side, which is exactly what we want here.
                    plant_id: primaryPlantId,
                    zone_id: primaryPlantId ? null : zoneId,
                    observed_at: todayISO(),
                    health_status: obsHealth || null,
                    notes: obsNotes.trim(),
                });
                createdSomething = true;
            }

            showToast({
                title: t('garden.scan.savedToast'),
                description: t('garden.scan.savedSummary', {
                    plants: plantIds.length,
                    care: selectedCare.length,
                }),
            });
            onOpenChange(false);
        } catch (err) {
            console.error('Garden scan save failed:', err);
            setError(
                createdSomething
                    ? t('garden.scan.errors.partial_save')
                    : err instanceof Error
                      ? err.message
                      : t('garden.common.genericError'),
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={t(mode === 'plant' ? 'garden.scan.titlePlant' : 'garden.scan.titleZone')}
            description={t(mode === 'plant' ? 'garden.scan.descPlant' : 'garden.scan.descZone')}
            className="sm:max-w-3xl"
        >
            <div className="space-y-5">
                {/* --- Photo --- */}
                <div>
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => handleFileChosen(e.target.files?.[0])}
                    />
                    {!previewUrl && (
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            className="flex w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-border bg-surface-2/50 px-6 py-10 text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5"
                        >
                            <Camera className="h-8 w-8 text-primary" />
                            <span className="text-body font-medium text-foreground">
                                {t('garden.scan.pickPhoto')}
                            </span>
                            <span className="text-label-sm">{t('garden.scan.formatsHint')}</span>
                        </button>
                    )}
                    {previewUrl && (
                        <div className="relative rounded-card border border-border bg-surface-2/50 p-2">
                            <img
                                src={previewUrl}
                                alt={t('garden.scan.previewAlt')}
                                className="mx-auto max-h-56 rounded-input object-contain"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    setFile(null);
                                    setScan(null);
                                    setError('');
                                    if (inputRef.current) inputRef.current.value = '';
                                }}
                                className="absolute right-3 top-3 rounded-full bg-card p-1.5 text-muted-foreground shadow-surface hover:text-foreground"
                                aria-label={t('garden.scan.removePhoto')}
                            >
                                <CloseIcon className="h-4 w-4" />
                            </button>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="flex items-start gap-2 rounded-input border border-danger/30 bg-danger-soft px-4 py-3 text-caption text-danger">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {file && !scan && (
                    <div className="flex justify-end">
                        <Button type="button" onClick={runScan} disabled={scanning}>
                            {scanning ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    {t('garden.scan.scanning')}
                                </>
                            ) : (
                                <>
                                    <ScanLine className="mr-2 h-4 w-4" />
                                    {t('garden.scan.analyze')}
                                </>
                            )}
                        </Button>
                    </div>
                )}

                {/* --- Nothing recognised --- */}
                {scan && !scan.detected && (
                    <div className="space-y-3 rounded-card border border-border bg-card p-4">
                        <p className="flex items-start gap-2 text-caption text-muted-foreground">
                            <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            {t('garden.scan.notDetected')}
                        </p>
                        {scan.warnings.map((w, i) => (
                            <p
                                key={i}
                                className="flex items-start gap-2 text-label-sm text-warning"
                            >
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                                {w}
                            </p>
                        ))}
                        <div className="flex justify-end">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={runScan}
                                disabled={scanning}
                            >
                                {t('garden.scan.rescan')}
                            </Button>
                        </div>
                    </div>
                )}

                {/* --- Editable proposal --- */}
                {scan?.detected && (
                    <section className="space-y-5 rounded-card border border-border bg-card p-4">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="flex items-center gap-2 text-h2 font-semibold">
                                <Check className="h-5 w-5 text-success" />
                                {t('garden.scan.proposalTitle')}
                            </h3>
                            <span
                                className={`rounded-pill px-2.5 py-0.5 text-label-sm font-medium ${CONFIDENCE_STYLE[scan.confidence]}`}
                            >
                                {t('garden.scan.confidence.' + scan.confidence)}
                            </span>
                        </div>

                        {scan.warnings.length > 0 && (
                            <ul className="space-y-1">
                                {scan.warnings.map((w, i) => (
                                    <li
                                        key={i}
                                        className="flex items-start gap-2 text-label-sm text-warning"
                                    >
                                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                                        {w}
                                    </li>
                                ))}
                            </ul>
                        )}

                        {/* Zone target */}
                        <div className="space-y-3">
                            <label className="block text-caption font-medium text-foreground">
                                {t('garden.scan.zoneTarget')}
                            </label>
                            <Select
                                value={zoneChoice}
                                onValueChange={setZoneChoice}
                                placeholder={t('garden.common.none')}
                                options={zoneOptions}
                            />
                            {zoneChoice === NEW_ZONE && (
                                <div className="grid grid-cols-1 gap-3 rounded-input bg-surface-2/50 p-3 sm:grid-cols-3">
                                    <Input
                                        label={t('garden.zone.name')}
                                        value={zoneName}
                                        onChange={(e) => setZoneName(e.target.value)}
                                    />
                                    <div>
                                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                                            {t('garden.zone.type')}
                                        </label>
                                        <Select
                                            value={zoneType}
                                            onValueChange={(v) => setZoneType(v as GardenZoneType)}
                                            options={GARDEN_ZONE_TYPES.map((zt) => ({
                                                value: zt,
                                                label: t('garden.zoneTypes.' + zt, {
                                                    defaultValue: zt,
                                                }),
                                            }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                                            {t('garden.zone.sunExposure')}
                                        </label>
                                        <Select
                                            value={zoneSun}
                                            onValueChange={(v) =>
                                                setZoneSun(v as GardenSunExposure | '')
                                            }
                                            placeholder={t('garden.common.none')}
                                            options={[
                                                { value: '', label: t('garden.common.none') },
                                                ...GARDEN_SUN_EXPOSURES.map((s) => ({
                                                    value: s,
                                                    label: t('garden.sunExposures.' + s, {
                                                        defaultValue: s,
                                                    }),
                                                })),
                                            ]}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Plants */}
                        {plantRows.length > 0 && (
                            <div className="space-y-2">
                                <h4 className="flex items-center gap-1.5 text-caption font-semibold text-foreground">
                                    <Sprout className="h-4 w-4 text-primary" />
                                    {t('garden.scan.plantsTitle')}
                                </h4>
                                {plantRows.map((p, i) => (
                                    <div
                                        key={i}
                                        className="grid grid-cols-1 items-end gap-3 rounded-input border border-border p-3 sm:grid-cols-[auto,1fr,1fr,1fr]"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={p.include}
                                            onChange={(e) =>
                                                updatePlant(i, { include: e.target.checked })
                                            }
                                            className="h-4 w-4 rounded border-border accent-primary sm:mb-2.5"
                                            aria-label={t('garden.scan.includeItem')}
                                        />
                                        <Input
                                            label={t('garden.plant.name')}
                                            value={p.name}
                                            onChange={(e) =>
                                                updatePlant(i, { name: e.target.value })
                                            }
                                        />
                                        <div>
                                            <label className="mb-1.5 block text-caption font-medium text-foreground">
                                                {t('garden.plant.type')}
                                            </label>
                                            <Select
                                                value={p.plant_type}
                                                onValueChange={(v) =>
                                                    updatePlant(i, {
                                                        plant_type: v as GardenPlantType,
                                                    })
                                                }
                                                options={GARDEN_PLANT_TYPES.map((pt) => ({
                                                    value: pt,
                                                    label: t('garden.plantTypes.' + pt, {
                                                        defaultValue: pt,
                                                    }),
                                                }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-caption font-medium text-foreground">
                                                {t('garden.plant.healthStatus')}
                                            </label>
                                            <Select
                                                value={p.health_status}
                                                onValueChange={(v) =>
                                                    updatePlant(i, {
                                                        health_status: v as GardenHealthStatus,
                                                    })
                                                }
                                                options={GARDEN_HEALTH_STATUSES.map((h) => ({
                                                    value: h,
                                                    label: t('garden.healthStatuses.' + h, {
                                                        defaultValue: h,
                                                    }),
                                                }))}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Care */}
                        {careRows.length > 0 && (
                            <div className="space-y-2">
                                <h4 className="text-caption font-semibold text-foreground">
                                    {t('garden.scan.careTitle')}
                                </h4>
                                {careRows.map((c, i) => (
                                    <div
                                        key={i}
                                        className="space-y-3 rounded-input border border-border p-3"
                                    >
                                        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[auto,1fr,1fr,1fr]">
                                            <input
                                                type="checkbox"
                                                checked={c.include}
                                                onChange={(e) =>
                                                    updateCare(i, { include: e.target.checked })
                                                }
                                                className="h-4 w-4 rounded border-border accent-primary sm:mb-2.5"
                                                aria-label={t('garden.scan.includeItem')}
                                            />
                                            <Input
                                                label={t('garden.care.title')}
                                                value={c.title}
                                                onChange={(e) =>
                                                    updateCare(i, { title: e.target.value })
                                                }
                                            />
                                            <div>
                                                <label className="mb-1.5 block text-caption font-medium text-foreground">
                                                    {t('garden.care.type')}
                                                </label>
                                                <Select
                                                    value={c.care_type}
                                                    onValueChange={(v) =>
                                                        updateCare(i, {
                                                            care_type: v as GardenCareType,
                                                        })
                                                    }
                                                    options={GARDEN_CARE_TYPES.map((ct) => ({
                                                        value: ct,
                                                        label: t('garden.careTypes.' + ct, {
                                                            defaultValue: ct,
                                                        }),
                                                    }))}
                                                />
                                            </div>
                                            <DatePicker
                                                label={t('garden.care.plannedDate')}
                                                value={c.planned_date}
                                                onChange={(v) => updateCare(i, { planned_date: v })}
                                            />
                                        </div>
                                        {c.notes && (
                                            <p className="text-label-sm text-muted-foreground">
                                                {c.notes}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Journal */}
                        {scan.observation && (
                            <div className="space-y-3">
                                <label className="flex items-center gap-2 text-caption font-semibold text-foreground">
                                    <input
                                        type="checkbox"
                                        checked={obsInclude && canAttachObservation}
                                        disabled={!canAttachObservation}
                                        onChange={(e) => setObsInclude(e.target.checked)}
                                        className="h-4 w-4 rounded border-border accent-primary"
                                    />
                                    {t('garden.scan.journalTitle')}
                                </label>
                                {!canAttachObservation && (
                                    <p className="text-label-sm text-muted-foreground">
                                        {t('garden.scan.journalNeedsTarget')}
                                    </p>
                                )}
                                <Textarea
                                    value={obsNotes}
                                    onChange={(e) => setObsNotes(e.target.value)}
                                    disabled={!obsInclude || !canAttachObservation}
                                />
                                <div className="sm:max-w-xs">
                                    <label className="mb-1.5 block text-caption font-medium text-foreground">
                                        {t('garden.plant.healthStatus')}
                                    </label>
                                    <Select
                                        value={obsHealth}
                                        onValueChange={(v) =>
                                            setObsHealth(v as GardenHealthStatus | '')
                                        }
                                        placeholder={t('garden.common.none')}
                                        options={[
                                            { value: '', label: t('garden.common.none') },
                                            ...GARDEN_HEALTH_STATUSES.map((h) => ({
                                                value: h,
                                                label: t('garden.healthStatuses.' + h, {
                                                    defaultValue: h,
                                                }),
                                            })),
                                        ]}
                                    />
                                </div>
                            </div>
                        )}

                        <p className="flex items-start gap-2 text-label-sm text-muted-foreground">
                            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                            {t('garden.scan.reviewHint')}
                        </p>

                        <div className="flex justify-end gap-2 pt-1">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={runScan}
                                disabled={scanning || saving}
                            >
                                {scanning ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        {t('garden.scan.scanning')}
                                    </>
                                ) : (
                                    t('garden.scan.rescan')
                                )}
                            </Button>
                            <Button
                                type="button"
                                onClick={save}
                                disabled={saving || scanning || nothingSelected}
                            >
                                {saving ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        {t('garden.scan.saving')}
                                    </>
                                ) : (
                                    <>
                                        <Check className="mr-1.5 h-4 w-4" />
                                        {t('garden.scan.confirm')}
                                    </>
                                )}
                            </Button>
                        </div>
                    </section>
                )}

                <div className="flex justify-end pt-2">
                    <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                        {t('garden.common.close')}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};

export default GardenScanDialog;
