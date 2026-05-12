import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryClient';

// =============================================================================
// Documents hooks (Phase 5).
// Upload uses XMLHttpRequest because `fetch` doesn't expose progress events;
// the bell-slow upload of a 30 MB PDF deserves a real progress bar.
// =============================================================================

export const DOCUMENT_CATEGORIES = [
    'Facture',
    'Contrat',
    'Manuel',
    'Notice',
    'Photo',
    'Garantie',
    'Attestation',
    'Autre',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export type DocumentEntityType = 'equipment' | 'contract' | 'contact' | 'item' | 'project';

export interface HouseDocument {
    id: string;
    name: string;
    category: DocumentCategory;
    file_name: string;
    file_size: number;
    mime_type: string;
    storage_key: string;
    equipment_id: string | null;
    contract_id: string | null;
    contact_id: string | null;
    item_id: string | null;
    project_id: string | null;
    notes: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface DocumentFilters {
    entity_type?: DocumentEntityType;
    entity_id?: string;
    category?: DocumentCategory;
    q?: string;
    unlinked?: boolean;
}

export const useDocuments = (filters?: DocumentFilters) =>
    useQuery({
        queryKey: queryKeys.documents.list(filters),
        queryFn: async () => {
            const params = new URLSearchParams();
            if (filters?.entity_type) params.set('entity_type', filters.entity_type);
            if (filters?.entity_id) params.set('entity_id', filters.entity_id);
            if (filters?.category) params.set('category', filters.category);
            if (filters?.q) params.set('q', filters.q);
            if (filters?.unlinked !== undefined) params.set('unlinked', String(filters.unlinked));
            const suffix = params.toString();
            const r = await api.get<{ success: boolean; data: HouseDocument[] }>(
                `/api/documents${suffix ? `?${suffix}` : ''}`,
            );
            return r.data;
        },
    });

export interface UploadDocumentInput {
    file: File;
    name?: string;
    category: DocumentCategory;
    notes?: string;
    entity_type?: DocumentEntityType;
    entity_id?: string;
    onProgress?: (percent: number) => void;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * XHR-based upload. Returns a Promise that resolves with the document
 * record OR rejects with a {status, error, code?} payload the caller can
 * map to a friendly message ("Fichier trop volumineux", etc.).
 */
const xhrUpload = (input: UploadDocumentInput): Promise<HouseDocument> =>
    new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/api/documents/upload`);
        xhr.withCredentials = true; // send the of_at cookie
        xhr.responseType = 'json';

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable && input.onProgress) {
                input.onProgress(Math.round((e.loaded / e.total) * 100));
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.success) {
                resolve(xhr.response.data as HouseDocument);
                return;
            }
            const errorBody = xhr.response?.error;
            const code = typeof errorBody === 'object' ? errorBody?.code : undefined;
            const message =
                (typeof errorBody === 'object' ? errorBody?.message : errorBody) ||
                `Upload failed (HTTP ${xhr.status})`;
            reject(Object.assign(new Error(message), { status: xhr.status, code }));
        });
        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
        xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

        const fd = new FormData();
        fd.append('file', input.file, input.file.name);
        fd.append('name', input.name?.trim() || input.file.name);
        fd.append('category', input.category);
        if (input.notes) fd.append('notes', input.notes);
        if (input.entity_type && input.entity_id) {
            fd.append('entity_type', input.entity_type);
            fd.append('entity_id', input.entity_id);
        }
        xhr.send(fd);
    });

export const useUploadDocument = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: xhrUpload,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: queryKeys.documents.all });
            // House dashboard count may include doc count later — invalidate
            // the house tree too so badges refresh.
            qc.invalidateQueries({ queryKey: queryKeys.house.all });
        },
    });
};

export const useUpdateDocument = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            id,
            patch,
        }: {
            id: string;
            patch: Partial<HouseDocument> & {
                entity_type?: DocumentEntityType | null;
                entity_id?: string | null;
            };
        }) => {
            const r = await api.patch<{ success: boolean; data: HouseDocument }>(
                `/api/documents/${id}`,
                patch,
            );
            return r.data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: queryKeys.documents.all });
            qc.invalidateQueries({ queryKey: queryKeys.house.all });
        },
    });
};

export const useDeleteDocument = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<{ success: boolean }>(`/api/documents/${id}`);
            return id;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: queryKeys.documents.all });
            qc.invalidateQueries({ queryKey: queryKeys.house.all });
        },
    });
};

/** URL of the file proxy endpoint. Use as <img src> or window.open target. */
export const documentFileUrl = (id: string, opts?: { download?: boolean }): string =>
    `${API_URL}/api/documents/${id}/file${opts?.download ? '?download=1' : ''}`;

/** Quick helper: is this MIME type a previewable image? */
export const isPreviewableImage = (mime: string): boolean => mime.startsWith('image/');

/** Quick helper: is this a PDF? */
export const isPdf = (mime: string): boolean => mime === 'application/pdf';

/** Friendly file size formatting. */
export const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
};
