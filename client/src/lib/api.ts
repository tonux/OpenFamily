const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const AUTH_EXPIRED_EVENT = 'openfamily:auth-expired';

// =============================================================================
// Auth model
//
// The JWT is no longer accessible to JavaScript. The server delivers two
// httpOnly cookies on login:
//   - `of_at` (access token, ~1h, scoped to "/")
//   - `of_rt` (refresh token, ~7d, scoped to "/api/auth")
//
// JS code in this client cannot read these cookies (httpOnly). Instead, every
// request is sent with `credentials: "include"` so the browser attaches them
// automatically. Authentication state in the UI is inferred from whether
// `/api/auth/me` succeeds, not from a local token.
//
// On any 401, this client transparently attempts ONE token refresh through
// `/api/auth/refresh`. If that succeeds, the original request is retried. If
// it fails, an `openfamily:auth-expired` event is dispatched and the UI is
// expected to redirect to the login screen.
// =============================================================================

interface RequestOpts extends RequestInit {
    _retried?: boolean;
}

class ApiClient {
    private baseURL: string;
    private refreshInFlight: Promise<boolean> | null = null;

    constructor(baseURL: string) {
        this.baseURL = baseURL;
    }

    /**
     * Ask the server to swap the refresh cookie for fresh access + refresh
     * cookies. Returns true on success. Concurrent calls share a single
     * in-flight promise so a burst of 401s only triggers one refresh.
     */
    private async refresh(): Promise<boolean> {
        if (!this.refreshInFlight) {
            this.refreshInFlight = (async () => {
                try {
                    const r = await fetch(`${this.baseURL}/api/auth/refresh`, {
                        method: 'POST',
                        credentials: 'include',
                    });
                    return r.ok;
                } catch {
                    return false;
                } finally {
                    // Release the slot at the end of the microtask so callers
                    // chained on the same promise still see the resolved value.
                    setTimeout(() => {
                        this.refreshInFlight = null;
                    }, 0);
                }
            })();
        }
        return this.refreshInFlight;
    }

    private async request<T>(endpoint: string, options: RequestOpts = {}): Promise<T> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(options.headers as Record<string, string> | undefined),
        };

        const response = await fetch(`${this.baseURL}${endpoint}`, {
            ...options,
            headers,
            credentials: 'include',
        });

        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json') ? await response.json() : null;

        if (response.status === 401) {
            // Never try to refresh a /auth endpoint with itself.
            const isAuthEndpoint = endpoint.startsWith('/api/auth/');
            if (!isAuthEndpoint && !options._retried) {
                const refreshed = await this.refresh();
                if (refreshed) {
                    return this.request<T>(endpoint, { ...options, _retried: true });
                }
            }

            window.dispatchEvent(
                new CustomEvent(AUTH_EXPIRED_EVENT, {
                    detail: data?.error || data?.message || 'Unauthorized',
                }),
            );
            throw new Error(data?.error || data?.message || 'Unauthorized');
        }

        if (!response.ok) {
            throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
        }

        return data as T;
    }

    async get<T>(endpoint: string): Promise<T> {
        return this.request<T>(endpoint, { method: 'GET' });
    }

    async post<T>(endpoint: string, body: any): Promise<T> {
        return this.request<T>(endpoint, {
            method: 'POST',
            body: JSON.stringify(body),
        });
    }

    async put<T>(endpoint: string, body: any): Promise<T> {
        return this.request<T>(endpoint, {
            method: 'PUT',
            body: JSON.stringify(body),
        });
    }

    async patch<T>(endpoint: string, body: any): Promise<T> {
        return this.request<T>(endpoint, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
    }

    async delete<T>(endpoint: string): Promise<T> {
        return this.request<T>(endpoint, { method: 'DELETE' });
    }

    // Authentication methods — the server sets cookies, we just forward the
    // user info to the caller (AuthContext stores it for convenience).
    async login(email: string, password: string) {
        const response = await this.post<any>('/api/auth/login', { email, password });
        if (response.success && response.data) {
            return { success: true, ...response.data };
        }
        return response;
    }

    async register(email: string, password: string, name: string) {
        const response = await this.post<any>('/api/auth/register', { email, password, name });
        if (response.success && response.data) {
            return { success: true, ...response.data };
        }
        return response;
    }

    async logout(): Promise<void> {
        try {
            await fetch(`${this.baseURL}/api/auth/logout`, {
                method: 'POST',
                credentials: 'include',
            });
        } catch {
            // Network failure on logout is non-fatal — cookies will eventually
            // expire on their own and the UI clears local state regardless.
        }
    }
}

export const api = new ApiClient(API_URL);
