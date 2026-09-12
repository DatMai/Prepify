import type { JourneyJournal, JourneySnapshot } from '../journey/types';
import type { Topic, TopicIndexEntry } from '../types/quiz';
import type { FeedArticle } from '../feed/types';
import { t, type Lang } from '../i18n';

const API_ORIGIN = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
export const API_ROOT = `${API_ORIGIN.replace(/\/$/, '')}/api/v1`;

function authHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' };
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(API_ROOT + path, {
      ...options,
      headers: { ...authHeaders(), ...options?.headers },
      credentials: 'include',
      signal: options?.signal ?? controller.signal,
    });
    const json = (res.status === 204 ? undefined : await res.json()) as T;
    if (!res.ok) {
      const body = json as {
        error?: string | { code?: string; message?: string };
        code?: string;
      };
      const code = typeof body.error === 'object' ? body.error.code : body.code;
      const serverMessage = typeof body.error === 'object' ? body.error.message : body.error;
      const key = code ? `api.${code}` : '';
      const translated = key ? t(key) : '';
      const message =
        translated && translated !== key ? translated : (serverMessage ?? t('err.generic'));
      throw new ApiError(message, res.status, code);
    }
    return json;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(t('api.request_timeout'), 0, 'request_timeout');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarId?: number;
  location?: string | null;
  emailVerifiedAt?: string | null;
  role: 'user' | 'admin';
}

export interface AuthResponse {
  user: AuthUser;
}

export const api = {
  auth: {
    register: (email: string, password: string, displayName?: string) =>
      apiRequest<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName }),
      }),

    login: (email: string, password: string) =>
      apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),

    session: () => apiRequest<{ user: AuthUser }>('/auth/session'),

    me: () => apiRequest<AuthUser>('/auth/me'),

    logout: () => apiRequest<void>('/auth/session', { method: 'DELETE' }),

    updateProfile: (data: { displayName?: string; location?: string; avatarId?: number }) =>
      apiRequest<{ displayName: string | null; location: string | null; avatarId: number }>(
        '/auth/profile',
        {
          method: 'PATCH',
          body: JSON.stringify(data),
        },
      ),

    resendVerification: () =>
      apiRequest<{ ok: boolean }>('/auth/resend-verification', { method: 'POST' }),

    forgotByEmail: (email: string) =>
      apiRequest<{ ok: boolean; message: string }>('/auth/forgot/email', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),

    resetPassword: (token: string, newPassword: string) =>
      apiRequest<{ ok: boolean }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      }),
  },

  progress: {
    get: () => apiRequest<{ data: Record<string, boolean> }>('/progress'),
    put: (data: Record<string, boolean>) =>
      apiRequest<{ ok: boolean }>('/progress', {
        method: 'PUT',
        body: JSON.stringify({ data }),
      }),
    patch: (key: string, value: boolean) =>
      apiRequest<{ ok: boolean }>('/progress', {
        method: 'PATCH',
        body: JSON.stringify({ key, value }),
      }),
  },

  journey: {
    today: () => apiRequest<JourneySnapshot>('/journey/today'),

    updateTask: (
      taskId: string,
      completed: boolean,
      evidence: string | undefined,
      revision: string,
      eventId: string,
    ) =>
      apiRequest<JourneySnapshot>(`/journey/today/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: {
          'If-Match': revision,
          'Idempotency-Key': eventId,
        },
        body: JSON.stringify({ completed, evidence }),
      }),

    saveJournal: (journal: JourneyJournal, revision: string) =>
      apiRequest<JourneySnapshot>('/journey/today/journal', {
        method: 'PUT',
        headers: { 'If-Match': revision },
        body: JSON.stringify(journal),
      }),

    addEvidence: (evidence: string, revision: string, eventId: string) =>
      apiRequest<JourneySnapshot>('/journey/today/evidence', {
        method: 'POST',
        headers: {
          'If-Match': revision,
          'Idempotency-Key': eventId,
        },
        body: JSON.stringify({ evidence }),
      }),
  },

  library: {
    index: (lang: Lang) => apiRequest<TopicIndexEntry[]>(`/library/index?lang=${lang}`),
    topic: (key: string, lang: Lang) =>
      apiRequest<Topic>(`/library/topics/${encodeURIComponent(key)}?lang=${lang}`),
  },

  feed: {
    list: (limit = 30) => apiRequest<{ items: FeedArticle[] }>(`/feed?limit=${limit}`),
  },
};
