import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';

// =============================================================================
// Client-side hooks for the AI shopping endpoints (PR #17).
//
// These are mutations rather than queries: each call sends user-written text
// and returns a fresh response. Cache lives server-side in
// ai_classification_cache; the client just kicks the request.
// =============================================================================

export type AiShoppingCategory = 'Alimentation' | 'Bebe' | 'Menage' | 'Sante' | 'Autre';

export interface AiClassifyResponse {
    category: AiShoppingCategory;
    cached: boolean;
    model: string;
}

export interface AiParsedItem {
    name: string;
    quantity: number | null;
    unit: string | null;
    category: AiShoppingCategory;
}

interface ApiResponse<T> {
    success: boolean;
    data: T;
    error?: { code?: string; message?: string } | string;
}

export const useClassifyShoppingItem = () =>
    useMutation({
        mutationFn: async (name: string): Promise<AiClassifyResponse> => {
            const r = await api.post<ApiResponse<AiClassifyResponse>>('/api/ai/shopping/classify', {
                name,
            });
            if (!r.success) throw new Error('AI classify failed');
            return r.data;
        },
    });

export const useParseShoppingText = () =>
    useMutation({
        mutationFn: async (text: string): Promise<AiParsedItem[]> => {
            const r = await api.post<ApiResponse<{ items: AiParsedItem[] }>>(
                '/api/ai/shopping/parse',
                { text },
            );
            if (!r.success) throw new Error('AI parse failed');
            return r.data.items;
        },
    });
