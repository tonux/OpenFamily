import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryClient';

// =============================================================================
// Notifications hooks (in-app, Phase 3).
// The bell icon polls /api/notifications/unread-count every 60s for the
// badge; opening the dropdown loads the actual list.
// =============================================================================

export interface Notification {
    id: string;
    title: string;
    message: string;
    type: string;
    is_read: boolean;
    related_id: string | null;
    created_at: string;
    updated_at: string;
}

export const useNotifications = () =>
    useQuery({
        queryKey: queryKeys.notifications.list(),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: Notification[] }>(
                '/api/notifications?limit=50',
            );
            return r.data;
        },
        // Refresh when the user opens the dropdown — staleTime small so the
        // first open after waking up always shows fresh data.
        staleTime: 30_000,
    });

export const useUnreadNotificationsCount = () =>
    useQuery({
        queryKey: queryKeys.notifications.unreadCount(),
        queryFn: async () => {
            const r = await api.get<{ success: boolean; data: { count: number } }>(
                '/api/notifications/unread-count',
            );
            return r.data.count;
        },
        // Cheap server-side query (count on indexed column). Polling every
        // 60s gives near-real-time UX without a WebSocket.
        staleTime: 60_000,
        refetchInterval: 60_000,
    });

export const useMarkNotificationRead = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.patch<{ success: boolean }>(`/api/notifications/${id}/read`, {});
            return id;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
        },
    });
};

export const useMarkAllNotificationsRead = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            const r = await api.post<{ success: boolean; data: { updated: number } }>(
                '/api/notifications/mark-all-read',
                {},
            );
            return r.data.updated;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
        },
    });
};

export const useDeleteNotification = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/notifications/${id}`);
            return id;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
        },
    });
};

/**
 * Map a notification type to the route the user should land on when they
 * click it. Falls back to the dashboard for unknown types.
 */
export const notificationDestination = (notification: Notification): string => {
    switch (notification.type) {
        case 'appointment_reminder_30min':
        case 'appointment_reminder_1hour':
            return '/calendar';
        case 'task_due_today':
        case 'task_overdue':
            return '/tasks';
        case 'contract_due_soon':
            return '/house';
        case 'maintenance_due_soon':
        case 'warranty_expiring':
            return '/house';
        default:
            return '/';
    }
};
