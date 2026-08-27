import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Home, Loader2, Save } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea } from '../ui';
import {
    CLIMATE_ZONES,
    DWELLING_TYPES,
    HEATING_TYPES,
    ROOF_TYPES,
    useHouseProfile,
    useSaveHouseProfile,
    type ClimateZone,
    type DwellingType,
    type HeatingType,
    type HouseProfile,
} from '../../hooks/useHouseCare';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called after a successful save — the tab uses it to offer seeding. */
    onSaved?: (profile: HouseProfile) => void;
}

const numberOrNull = (v: string): number | null => {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * The house profile. Everything downstream depends on it: which catalog tasks
 * apply, what the AI knows about the place, and the big-ticket forecast. Kept
 * to facts a new owner can actually answer — the install years come off the
 * inspection report or the appliance plate, not from memory.
 */
export const HouseProfileDialog: React.FC<Props> = ({ open, onOpenChange, onSaved }) => {
    const { t } = useTranslation();
    const { data: profile } = useHouseProfile();
    const save = useSaveHouseProfile();

    const [form, setForm] = useState<Partial<HouseProfile>>({});
    const [error, setError] = useState('');

    useEffect(() => {
        if (open && profile) setForm({ ...profile });
        if (open) setError('');
    }, [open, profile]);

    const set = <K extends keyof HouseProfile>(key: K, value: HouseProfile[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const toggleHeating = (type: HeatingType) => {
        const current = (form.heating_types ?? []) as HeatingType[];
        set(
            'heating_types',
            current.includes(type) ? current.filter((h) => h !== type) : [...current, type],
        );
    };

    const submit = async () => {
        setError('');
        try {
            const saved = await save.mutateAsync({
                dwelling_type: form.dwelling_type,
                build_year: form.build_year ?? null,
                living_area_m2: form.living_area_m2 ?? null,
                occupants: form.occupants ?? null,
                climate_zone: form.climate_zone,
                has_basement: form.has_basement ?? false,
                basement_finished: form.basement_finished ?? false,
                has_sump_pump: form.has_sump_pump ?? false,
                has_garage: form.has_garage ?? false,
                has_pool: form.has_pool ?? false,
                has_septic: form.has_septic ?? false,
                has_well: form.has_well ?? false,
                has_irrigation: form.has_irrigation ?? false,
                has_air_exchanger: form.has_air_exchanger ?? false,
                heating_types: form.heating_types ?? [],
                roof_type: form.roof_type ?? null,
                roof_year: form.roof_year ?? null,
                water_heater_year: form.water_heater_year ?? null,
                windows_year: form.windows_year ?? null,
                siding_type: form.siding_type ?? null,
                property_value: form.property_value ?? null,
                notes: form.notes ?? null,
            });
            onSaved?.(saved);
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('house.common.saveError'));
        }
    };

    const features: Array<{ key: keyof HouseProfile; label: string; hint?: string }> = [
        { key: 'has_basement', label: t('house.care.profile.hasBasement') },
        { key: 'basement_finished', label: t('house.care.profile.basementFinished') },
        {
            key: 'has_sump_pump',
            label: t('house.care.profile.hasSumpPump'),
            hint: t('house.care.profile.hasSumpPumpHint'),
        },
        { key: 'has_garage', label: t('house.care.profile.hasGarage') },
        { key: 'has_air_exchanger', label: t('house.care.profile.hasAirExchanger') },
        { key: 'has_pool', label: t('house.care.profile.hasPool') },
        { key: 'has_septic', label: t('house.care.profile.hasSeptic') },
        { key: 'has_well', label: t('house.care.profile.hasWell') },
        { key: 'has_irrigation', label: t('house.care.profile.hasIrrigation') },
    ];

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={t('house.care.profile.title')}
            description={t('house.care.profile.description')}
            className="sm:max-w-2xl"
        >
            <div className="space-y-6">
                <section className="space-y-3">
                    <h4 className="flex items-center gap-2 text-caption font-semibold text-foreground">
                        <Home className="h-4 w-4" />
                        {t('house.care.profile.sectionBasics')}
                    </h4>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="mb-1.5 block text-caption font-medium">
                                {t('house.care.profile.dwellingType')}
                            </label>
                            <Select
                                value={form.dwelling_type ?? 'Unifamiliale'}
                                onValueChange={(v) => set('dwelling_type', v as DwellingType)}
                                options={DWELLING_TYPES.map((d) => ({ value: d, label: d }))}
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-caption font-medium">
                                {t('house.care.profile.climateZone')}
                            </label>
                            <Select
                                value={form.climate_zone ?? 'Continental humide (hivers rigoureux)'}
                                onValueChange={(v) => set('climate_zone', v as ClimateZone)}
                                options={CLIMATE_ZONES.map((c) => ({ value: c, label: c }))}
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-caption font-medium">
                                {t('house.care.profile.buildYear')}
                            </label>
                            <Input
                                type="number"
                                value={form.build_year ?? ''}
                                onChange={(e) => set('build_year', numberOrNull(e.target.value))}
                                placeholder="1998"
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-caption font-medium">
                                {t('house.care.profile.livingArea')}
                            </label>
                            <Input
                                type="number"
                                value={form.living_area_m2 ?? ''}
                                onChange={(e) =>
                                    set('living_area_m2', numberOrNull(e.target.value))
                                }
                                placeholder="140"
                            />
                        </div>
                    </div>
                </section>

                <section className="space-y-3">
                    <h4 className="text-caption font-semibold text-foreground">
                        {t('house.care.profile.sectionFeatures')}
                    </h4>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {features.map((f) => (
                            <label
                                key={String(f.key)}
                                className="flex cursor-pointer items-start gap-2.5 rounded-input border border-border px-3 py-2.5 hover:border-primary/40"
                            >
                                <input
                                    type="checkbox"
                                    className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
                                    checked={Boolean(form[f.key])}
                                    onChange={(e) =>
                                        set(f.key, e.target.checked as HouseProfile[typeof f.key])
                                    }
                                />
                                <span className="min-w-0">
                                    <span className="block text-caption text-foreground">
                                        {f.label}
                                    </span>
                                    {f.hint && (
                                        <span className="block text-micro text-muted-foreground">
                                            {f.hint}
                                        </span>
                                    )}
                                </span>
                            </label>
                        ))}
                    </div>
                </section>

                <section className="space-y-3">
                    <h4 className="text-caption font-semibold text-foreground">
                        {t('house.care.profile.sectionHeating')}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                        {HEATING_TYPES.map((h) => {
                            const active = (form.heating_types ?? []).includes(h);
                            return (
                                <button
                                    key={h}
                                    type="button"
                                    onClick={() => toggleHeating(h)}
                                    className={`rounded-full border px-3 py-1.5 text-label-sm transition-colors ${
                                        active
                                            ? 'border-primary bg-primary/10 text-foreground'
                                            : 'border-border text-muted-foreground hover:border-primary/40'
                                    }`}
                                >
                                    {h}
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className="space-y-3">
                    <h4 className="text-caption font-semibold text-foreground">
                        {t('house.care.profile.sectionAges')}
                    </h4>
                    <p className="text-micro text-muted-foreground">
                        {t('house.care.profile.agesHint')}
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="mb-1.5 block text-caption font-medium">
                                {t('house.care.profile.roofType')}
                            </label>
                            <Select
                                value={form.roof_type ?? ''}
                                onValueChange={(v) => set('roof_type', v || null)}
                                placeholder={t('house.care.profile.notSet')}
                                options={ROOF_TYPES.map((r) => ({ value: r, label: r }))}
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-caption font-medium">
                                {t('house.care.profile.roofYear')}
                            </label>
                            <Input
                                type="number"
                                value={form.roof_year ?? ''}
                                onChange={(e) => set('roof_year', numberOrNull(e.target.value))}
                                placeholder="2012"
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-caption font-medium">
                                {t('house.care.profile.waterHeaterYear')}
                            </label>
                            <Input
                                type="number"
                                value={form.water_heater_year ?? ''}
                                onChange={(e) =>
                                    set('water_heater_year', numberOrNull(e.target.value))
                                }
                                placeholder="2016"
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-caption font-medium">
                                {t('house.care.profile.windowsYear')}
                            </label>
                            <Input
                                type="number"
                                value={form.windows_year ?? ''}
                                onChange={(e) => set('windows_year', numberOrNull(e.target.value))}
                                placeholder="2005"
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-caption font-medium">
                                {t('house.care.profile.sidingType')}
                            </label>
                            <Input
                                value={form.siding_type ?? ''}
                                onChange={(e) => set('siding_type', e.target.value || null)}
                                placeholder={t('house.care.profile.sidingPlaceholder')}
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-caption font-medium">
                                {t('house.care.profile.propertyValue')}
                            </label>
                            <Input
                                type="number"
                                value={form.property_value ?? ''}
                                onChange={(e) =>
                                    set('property_value', numberOrNull(e.target.value))
                                }
                                placeholder="450000"
                            />
                            <p className="mt-1 text-micro text-muted-foreground">
                                {t('house.care.profile.propertyValueHint')}
                            </p>
                        </div>
                    </div>
                </section>

                <div>
                    <label className="mb-1.5 block text-caption font-medium">
                        {t('house.care.profile.notes')}
                    </label>
                    <Textarea
                        rows={3}
                        value={form.notes ?? ''}
                        onChange={(e) => set('notes', e.target.value || null)}
                        placeholder={t('house.care.profile.notesPlaceholder')}
                    />
                </div>

                {error && (
                    <p className="rounded-input border border-danger/30 bg-danger-soft px-3 py-2 text-caption text-danger">
                        {error}
                    </p>
                )}

                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        {t('house.common.cancel', { defaultValue: 'Annuler' })}
                    </Button>
                    <Button onClick={submit} disabled={save.isPending}>
                        {save.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        {t('house.care.profile.save')}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};

export default HouseProfileDialog;
