import React from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
    Wrench,
    ShieldCheck,
    ChevronRight,
    Plus,
    Home as HomeIcon,
    AlertCircle,
    CheckCircle2,
    Receipt,
} from 'lucide-react';
import { Card, CardContent, Button } from '../ui';
import { useHouseDashboard, usePayContract } from '../../hooks/useHouse';

// =============================================================================
// HouseAlertsCard
//
// Compact dashboard widget summarising the next house maintenance to do and
// the warranties about to expire. Empty state encourages adding a first
// equipment. All click-throughs land on /house.
// =============================================================================

const daysFromNow = (iso: string): number => {
    const target = new Date(`${iso}T12:00:00`).getTime();
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return Math.round((target - today.getTime()) / (24 * 60 * 60 * 1000));
};

const formatShortDate = (iso: string): string => format(parseISO(iso), 'dd MMM', { locale: fr });

const HouseAlertsCard: React.FC = () => {
    const query = useHouseDashboard();
    const payMut = usePayContract();
    const navigate = useNavigate();

    if (query.isPending) {
        return (
            <Card className="shadow-nexus border-none">
                <CardContent className="p-6 animate-pulse space-y-3">
                    <div className="h-5 w-40 rounded bg-surface-2" />
                    <div className="h-20 rounded bg-surface-2" />
                </CardContent>
            </Card>
        );
    }

    if (query.isError) {
        // Soft fail: this widget is optional, don't bother the user with a
        // banner — show the empty CTA so they can still discover the section.
        return null;
    }

    const data = query.data!;
    const nothing =
        data.upcoming_maintenance.length === 0 &&
        data.expiring_warranties.length === 0 &&
        data.upcoming_contracts.length === 0;
    const noData = data.counts.equipments === 0 && data.counts.active_contracts === 0;

    return (
        <Card className="shadow-nexus border-none">
            <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <h2 className="text-h2 font-semibold flex items-center gap-2">
                            <HomeIcon className="h-5 w-5 text-primary" />
                            Maison
                        </h2>
                        <p className="text-micro text-muted-foreground">
                            {data.counts.equipments} équipement
                            {data.counts.equipments > 1 ? 's' : ''}
                            {' · '}
                            {data.counts.upcoming_30d} entretien
                            {data.counts.upcoming_30d !== 1 ? 's' : ''} 30j
                            {' · '}
                            {data.counts.warranties_60d} garantie
                            {data.counts.warranties_60d !== 1 ? 's' : ''} 60j
                            {data.counts.active_contracts > 0 && (
                                <>
                                    {' · '}
                                    {data.counts.active_contracts} contrat
                                    {data.counts.active_contracts > 1 ? 's' : ''} actif
                                    {data.counts.active_contracts > 1 ? 's' : ''}
                                    {' · '}~ {data.monthly_estimated_total.toFixed(0)} €/mois
                                </>
                            )}
                        </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => navigate('/house')}>
                        Voir tout
                        <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                </div>

                {noData ? (
                    <div className="rounded-card border border-dashed border-border bg-muted/20 p-4 text-center">
                        <p className="text-caption font-medium">Pas encore de données maison</p>
                        <p className="text-micro text-muted-foreground mt-1">
                            Ajoute tes équipements ou tes contrats récurrents pour voir les alertes
                            ici.
                        </p>
                        <Button size="sm" className="mt-3" onClick={() => navigate('/house')}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            Ouvrir Maison
                        </Button>
                    </div>
                ) : nothing ? (
                    <div className="flex items-center gap-2 rounded-card border border-emerald-200 bg-emerald-50 px-3 py-2 text-caption text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                        Tous tes équipements sont à jour ✓
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Upcoming contracts */}
                        <div className="space-y-2">
                            <p className="text-caption font-semibold flex items-center gap-1.5">
                                <Receipt className="h-4 w-4 text-primary" />
                                Échéances 7j
                            </p>
                            {data.upcoming_contracts.length === 0 ? (
                                <p className="text-micro text-muted-foreground italic">
                                    Aucune échéance dans les 7 jours.
                                </p>
                            ) : (
                                <ul className="space-y-1.5">
                                    {data.upcoming_contracts.slice(0, 3).map((c) => {
                                        const days = daysFromNow(c.next_due_date);
                                        const overdue = days < 0;
                                        return (
                                            <li
                                                key={c.id}
                                                className={`rounded-input border px-3 py-2 text-micro ${
                                                    overdue
                                                        ? 'border-destructive/40 bg-destructive/5'
                                                        : 'border-border bg-card'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <p className="font-medium text-caption text-foreground truncate">
                                                        {c.name}
                                                    </p>
                                                    <button
                                                        type="button"
                                                        onClick={() => payMut.mutate({ id: c.id })}
                                                        className="text-micro text-primary hover:underline shrink-0"
                                                        title="Marquer payé"
                                                    >
                                                        Payé
                                                    </button>
                                                </div>
                                                <p
                                                    className={`text-micro ${
                                                        overdue
                                                            ? 'text-destructive'
                                                            : 'text-muted-foreground'
                                                    } truncate`}
                                                >
                                                    {c.amount.toFixed(2)} € ·{' '}
                                                    {formatShortDate(c.next_due_date)} (
                                                    {overdue
                                                        ? `retard ${-days}j`
                                                        : days === 0
                                                          ? "aujourd'hui"
                                                          : `dans ${days}j`}
                                                    )
                                                </p>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        {/* Upcoming maintenance */}
                        <div className="space-y-2">
                            <p className="text-caption font-semibold flex items-center gap-1.5">
                                <Wrench className="h-4 w-4 text-primary" />
                                Entretiens 30j
                            </p>
                            {data.upcoming_maintenance.length === 0 ? (
                                <p className="text-micro text-muted-foreground italic">
                                    Aucun entretien d'ici 30 jours.
                                </p>
                            ) : (
                                <ul className="space-y-1.5">
                                    {data.upcoming_maintenance.slice(0, 3).map((m) => {
                                        const days = m.planned_date
                                            ? daysFromNow(m.planned_date)
                                            : 0;
                                        const isUrgent = days <= 7;
                                        return (
                                            <li
                                                key={m.id}
                                                className="rounded-input border border-border bg-card px-3 py-2 text-micro"
                                            >
                                                <p className="font-medium text-caption text-foreground truncate">
                                                    {m.title}
                                                </p>
                                                <p className="text-micro text-muted-foreground truncate">
                                                    {m.equipment_name}
                                                    {' · '}
                                                    <span
                                                        className={
                                                            isUrgent
                                                                ? 'text-destructive font-medium'
                                                                : ''
                                                        }
                                                    >
                                                        {m.planned_date
                                                            ? formatShortDate(m.planned_date)
                                                            : ''}{' '}
                                                        (
                                                        {days >= 0
                                                            ? `dans ${days}j`
                                                            : `en retard ${-days}j`}
                                                        )
                                                    </span>
                                                </p>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        {/* Expiring warranties */}
                        <div className="space-y-2">
                            <p className="text-caption font-semibold flex items-center gap-1.5">
                                <ShieldCheck className="h-4 w-4 text-amber-600" />
                                Garanties 60j
                            </p>
                            {data.expiring_warranties.length === 0 ? (
                                <p className="text-micro text-muted-foreground italic">
                                    Aucune garantie à expirer d'ici 60 jours.
                                </p>
                            ) : (
                                <ul className="space-y-1.5">
                                    {data.expiring_warranties.slice(0, 3).map((w) => {
                                        const days = daysFromNow(w.warranty_until);
                                        return (
                                            <li
                                                key={w.id}
                                                className="rounded-input border border-amber-200 bg-amber-50 px-3 py-2 text-micro"
                                            >
                                                <p className="font-medium text-caption text-foreground truncate flex items-center gap-1">
                                                    <AlertCircle className="h-3 w-3 text-amber-600" />
                                                    {w.name}
                                                </p>
                                                <p className="text-amber-700">
                                                    Expire le {formatShortDate(w.warranty_until)}{' '}
                                                    (dans {days}j)
                                                </p>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default HouseAlertsCard;
