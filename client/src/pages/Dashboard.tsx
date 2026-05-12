import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
    ShoppingCart,
    CheckSquare,
    Calendar,
    Wallet,
    AlertCircle,
    Activity,
    ChevronRight,
    TrendingUp,
    TrendingDown,
    Minus,
    UtensilsCrossed,
    CalendarClock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useNavigate } from 'react-router-dom';
import { useCurrency } from '../lib/useCurrency';
import WeatherClothingCard from '../components/app/WeatherClothingCard';
import HouseAlertsCard from '../components/app/HouseAlertsCard';
import TodayTasksCard from '../components/app/TodayTasksCard';

interface KpiPayload {
    budget: {
        thisMonth: number;
        lastMonth: number;
        deltaRatio: number | null;
        topCategory: { category: string; amount: number } | null;
    };
    shopping: { total: number; checked: number; pending: number };
    mealPlanning: { plannedDays: number; totalDays: number };
    nextAppointment: { id: string; title: string; startTime: string } | null;
    overdueTasks: number;
}

interface DashboardStats {
    upcomingAppointments: number;
    pendingTasks: number;
    shoppingItems: number;
    thisMonthExpenses: number;
    budgetAlerts: number;
    kpis?: KpiPayload;
}

// =============================================================================
// QuickOverviewKpis
//
// Four concrete, time-anchored signals that replaced the original decorative
// "welcome to Nexus" banner. Each tile is its own self-contained KPI with a
// number, a one-line interpretation, and a click-through to the relevant page.
// Designed to degrade gracefully: if the backend hasn't been updated yet
// (`stats.kpis` undefined) the component falls back to a compact placeholder
// instead of crashing.
// =============================================================================
interface QuickOverviewKpisProps {
    stats: DashboardStats | null;
    formatMoney: (n: number, opts?: { maximumFractionDigits?: number }) => string;
    navigate: (path: string) => void;
}

const formatRelativeDate = (iso: string): string => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (24 * 3600 * 1000));
    if (diffDays === 0) return "aujourd'hui";
    if (diffDays === 1) return 'demain';
    if (diffDays > 1 && diffDays < 7) return `dans ${diffDays} jours`;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

const QuickOverviewKpis: React.FC<QuickOverviewKpisProps> = ({ stats, formatMoney, navigate }) => {
    const kpis = stats?.kpis;
    if (!kpis) {
        return (
            <p className="text-caption text-muted-foreground">
                Vos indicateurs apparaîtront ici dès que vous aurez ajouté des données.
            </p>
        );
    }

    // Shopping progress: percentage of the active list that's been checked off.
    const shoppingProgress =
        kpis.shopping.total > 0
            ? Math.round((kpis.shopping.checked / kpis.shopping.total) * 100)
            : 0;

    // Budget trend: pick the trend icon + tone from the delta ratio.
    const delta = kpis.budget.deltaRatio;
    const budgetTrend: {
        Icon: typeof TrendingUp;
        label: string;
        tone: 'good' | 'bad' | 'neutral';
    } = (() => {
        if (delta === null) return { Icon: Minus, label: 'Pas de comparaison', tone: 'neutral' };
        const pct = Math.round(delta * 100);
        if (Math.abs(pct) < 5)
            return { Icon: Minus, label: 'Stable vs mois dernier', tone: 'neutral' };
        if (pct > 0)
            return {
                Icon: TrendingUp,
                label: `+${pct}% vs mois dernier`,
                tone: 'bad', // more spending = bad signal
            };
        return {
            Icon: TrendingDown,
            label: `${pct}% vs mois dernier`,
            tone: 'good',
        };
    })();

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* KPI 1: Budget trend */}
            <button
                type="button"
                onClick={() => navigate('/budget')}
                className="text-left rounded-nexus border border-border/50 bg-card p-4 hover:border-nexus-blue/40 transition-colors"
            >
                <div className="flex items-center gap-2 text-label text-muted-foreground mb-2">
                    <Wallet className="h-4 w-4" />
                    Dépenses ce mois
                </div>
                <div className="text-h2 text-foreground">
                    {formatMoney(kpis.budget.thisMonth, { maximumFractionDigits: 0 })}
                </div>
                <div
                    className={`flex items-center gap-1 text-caption mt-2 ${
                        budgetTrend.tone === 'bad'
                            ? 'text-rose-600'
                            : budgetTrend.tone === 'good'
                              ? 'text-emerald-600'
                              : 'text-muted-foreground'
                    }`}
                >
                    <budgetTrend.Icon className="h-4 w-4" />
                    <span>{budgetTrend.label}</span>
                </div>
                {kpis.budget.topCategory ? (
                    <p className="text-micro text-muted-foreground mt-1">
                        Top poste :{' '}
                        <span className="font-medium">{kpis.budget.topCategory.category}</span> (
                        {formatMoney(kpis.budget.topCategory.amount, { maximumFractionDigits: 0 })})
                    </p>
                ) : null}
            </button>

            {/* KPI 2: Shopping list progress */}
            <button
                type="button"
                onClick={() => navigate('/shopping')}
                className="text-left rounded-nexus border border-border/50 bg-card p-4 hover:border-nexus-blue/40 transition-colors"
            >
                <div className="flex items-center gap-2 text-label text-muted-foreground mb-2">
                    <ShoppingCart className="h-4 w-4" />
                    Liste de courses
                </div>
                <div className="text-h2 text-foreground">
                    {kpis.shopping.pending}{' '}
                    <span className="text-body text-muted-foreground">à acheter</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                        className="h-full bg-emerald-500 transition-all"
                        style={{ width: `${shoppingProgress}%` }}
                        aria-label={`${shoppingProgress}% cochés`}
                    />
                </div>
                <p className="text-micro text-muted-foreground mt-1">
                    {kpis.shopping.checked}/{kpis.shopping.total} cochés · {shoppingProgress}%
                </p>
            </button>

            {/* KPI 3: Meal planning coverage */}
            <button
                type="button"
                onClick={() => navigate('/meal-planning')}
                className="text-left rounded-nexus border border-border/50 bg-card p-4 hover:border-nexus-blue/40 transition-colors"
            >
                <div className="flex items-center gap-2 text-label text-muted-foreground mb-2">
                    <UtensilsCrossed className="h-4 w-4" />
                    Repas planifiés
                </div>
                <div className="text-h2 text-foreground">
                    {kpis.mealPlanning.plannedDays}
                    <span className="text-body text-muted-foreground">
                        /{kpis.mealPlanning.totalDays} jours
                    </span>
                </div>
                <div className="flex gap-1 mt-2">
                    {Array.from({ length: kpis.mealPlanning.totalDays }, (_, i) => (
                        <div
                            key={i}
                            className={`h-2 flex-1 rounded-full ${
                                i < kpis.mealPlanning.plannedDays ? 'bg-amber-500' : 'bg-muted'
                            }`}
                        />
                    ))}
                </div>
                <p className="text-micro text-muted-foreground mt-1">
                    {kpis.mealPlanning.plannedDays === kpis.mealPlanning.totalDays
                        ? 'Semaine complète ✓'
                        : `${kpis.mealPlanning.totalDays - kpis.mealPlanning.plannedDays} jour(s) à planifier`}
                </p>
            </button>

            {/* KPI 4: Next appointment + overdue tasks */}
            <button
                type="button"
                onClick={() => navigate('/calendar')}
                className="text-left rounded-nexus border border-border/50 bg-card p-4 hover:border-nexus-blue/40 transition-colors"
            >
                <div className="flex items-center gap-2 text-label text-muted-foreground mb-2">
                    <CalendarClock className="h-4 w-4" />
                    Prochain rendez-vous
                </div>
                {kpis.nextAppointment ? (
                    <>
                        <div className="text-body font-semibold text-foreground truncate">
                            {kpis.nextAppointment.title}
                        </div>
                        <p className="text-caption text-nexus-blue mt-1">
                            {formatRelativeDate(kpis.nextAppointment.startTime)}
                        </p>
                    </>
                ) : (
                    <p className="text-body text-muted-foreground">Aucun à venir</p>
                )}
                {kpis.overdueTasks > 0 ? (
                    <p className="text-caption text-rose-600 mt-2 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {kpis.overdueTasks} tâche{kpis.overdueTasks > 1 ? 's' : ''} en retard
                    </p>
                ) : (
                    <p className="text-micro text-muted-foreground mt-2">Aucune tâche en retard</p>
                )}
            </button>
        </div>
    );
};

const Dashboard: React.FC = () => {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const { format: formatMoney } = useCurrency();

    useEffect(() => {
        loadStats();
    }, []);

    const loadStats = async () => {
        try {
            const response = await api.get<{ success: boolean; data: DashboardStats }>(
                '/api/dashboard',
            );
            if (response.success) {
                setStats(response.data);
            }
        } catch (error) {
            console.error('Failed to load dashboard stats:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center min-h-[50vh]">
                <div className="flex flex-col items-center gap-4">
                    <div className="spinner-brand" />
                    <p className="text-muted-foreground font-medium animate-pulse">
                        Chargement de votre espace...
                    </p>
                </div>
            </div>
        );
    }

    const statCards = [
        {
            title: 'Rendez-vous à venir',
            value: stats?.upcomingAppointments || 0,
            icon: Calendar,
            color: 'text-nexus-blue',
            bgColor: 'bg-blue-50',
            borderColor: 'border-blue-100',
            href: '/calendar',
        },
        {
            title: 'Tâches en attente',
            value: stats?.pendingTasks || 0,
            icon: CheckSquare,
            color: 'text-emerald-600',
            bgColor: 'bg-emerald-50',
            borderColor: 'border-emerald-100',
            href: '/tasks',
        },
        {
            title: 'Articles à acheter',
            value: stats?.shoppingItems || 0,
            icon: ShoppingCart,
            color: 'text-purple-600',
            bgColor: 'bg-purple-50',
            borderColor: 'border-purple-100',
            href: '/shopping',
        },
        {
            title: 'Dépenses du mois',
            value: formatMoney(Number(stats?.thisMonthExpenses || 0), { maximumFractionDigits: 0 }),
            icon: Wallet,
            color: 'text-nexus-amber',
            bgColor: 'bg-orange-50',
            borderColor: 'border-orange-100',
            href: '/budget',
        },
    ];

    return (
        <div className="space-y-8 animate-accordion-down">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-h1 text-foreground mb-1">Bonjour ! 👋</h1>
                    <p className="text-muted-foreground text-body">
                        Voici ce qu'il se passe dans votre famille aujourd'hui.
                    </p>
                </div>
                <div className="flex gap-3">
                    <Button variant="secondary" size="sm" onClick={() => navigate('/calendar')}>
                        <Activity className="w-4 h-4 mr-2" />
                        Voir l'activité
                    </Button>
                </div>
            </div>

            {stats && stats.budgetAlerts > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-nexus p-4 flex items-start gap-4 shadow-nexus-sm animate-pulse">
                    <div className="p-2 bg-amber-100 rounded-full shrink-0">
                        <AlertCircle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="flex-1">
                        <h3 className="font-semibold text-amber-900 text-body-sm">
                            Attention au budget
                        </h3>
                        <p className="text-sm text-amber-800 mt-1">
                            {stats.budgetAlerts} catégorie{stats.budgetAlerts > 1 ? 's ont' : ' a'}{' '}
                            dépassé le budget mensuel défini.
                        </p>
                    </div>
                    <Button
                        size="sm"
                        onClick={() => navigate('/budget')}
                        className="bg-amber-600 hover:bg-amber-700 text-white shrink-0 shadow-none border-0"
                    >
                        Voir détail
                    </Button>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {statCards.map((card) => {
                    const Icon = card.icon;
                    return (
                        <Card
                            key={card.title}
                            className={`border ${card.borderColor} bg-card group cursor-pointer`}
                            onClick={() => navigate(card.href)}
                        >
                            <CardContent className="p-6 flex items-start justify-between">
                                <div>
                                    <p className="text-label text-muted-foreground font-medium mb-1">
                                        {card.title}
                                    </p>
                                    <h3 className="text-3xl font-bold text-foreground tracking-tight group-hover:scale-105 transition-transform origin-left">
                                        {card.value}
                                    </h3>
                                </div>
                                <div
                                    className={`p-3 rounded-nexus ${card.bgColor} group-hover:rotate-6 transition-transform`}
                                >
                                    <Icon className={`h-6 w-6 ${card.color}`} />
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            <TodayTasksCard />

            <WeatherClothingCard />

            <HouseAlertsCard />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <Card className="lg:col-span-2 shadow-nexus border-none">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-xl">Aperçu rapide</CardTitle>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate('/calendar')}
                            className="text-nexus-blue hover:text-nexus-blue/80 hover:bg-blue-50"
                        >
                            Voir tout <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                    </CardHeader>
                    <CardContent>
                        <QuickOverviewKpis
                            stats={stats}
                            formatMoney={formatMoney}
                            navigate={navigate}
                        />
                    </CardContent>
                </Card>

                <Card className="shadow-nexus border-none h-full">
                    <CardHeader>
                        <CardTitle className="text-xl">Démarrage rapide</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <button
                            type="button"
                            onClick={() => navigate('/family')}
                            className="w-full p-4 text-left bg-nexus-background rounded-nexus hover:bg-blue-50 transition-colors cursor-pointer group border border-transparent hover:border-blue-100"
                        >
                            <h3 className="font-semibold text-body-sm mb-1 group-hover:text-nexus-blue transition-colors flex items-center gap-2">
                                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-nexus-blue text-white text-[10px]">
                                    1
                                </span>
                                Ajoutez votre famille
                            </h3>
                            <p className="text-label text-muted-foreground pl-7">
                                Créez des profils pour chaque membre
                            </p>
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/meal-planning')}
                            className="w-full p-4 text-left bg-nexus-background rounded-nexus hover:bg-blue-50 transition-colors cursor-pointer group border border-transparent hover:border-blue-100"
                        >
                            <h3 className="font-semibold text-body-sm mb-1 group-hover:text-nexus-blue transition-colors flex items-center gap-2">
                                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-nexus-blue text-white text-[10px]">
                                    2
                                </span>
                                Planifiez vos repas
                            </h3>
                            <p className="text-label text-muted-foreground pl-7">
                                Créez votre planning de la semaine
                            </p>
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/budget')}
                            className="w-full p-4 text-left bg-nexus-background rounded-nexus hover:bg-blue-50 transition-colors cursor-pointer group border border-transparent hover:border-blue-100"
                        >
                            <h3 className="font-semibold text-body-sm mb-1 group-hover:text-nexus-blue transition-colors flex items-center gap-2">
                                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-nexus-blue text-white text-[10px]">
                                    3
                                </span>
                                Suivez le budget
                            </h3>
                            <p className="text-label text-muted-foreground pl-7">
                                Définissez vos limites mensuelles
                            </p>
                        </button>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default Dashboard;
