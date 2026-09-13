import type { JourneyBlock, JourneyJournal, JourneySnapshot, JourneyTask } from '../journey/types';
import type { Topic, TopicIndexEntry } from '../types/quiz';
import type { FeedArticle } from '../feed/types';
import type { ReviewQuality, ReviewSchedule } from '../review/scheduler';
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
        message?: string;
        path?: string;
      };
      const code = typeof body.error === 'object' ? body.error.code : body.code;
      const nestedMessage = typeof body.error === 'object' ? body.error.message : undefined;
      // Flat `{ error, code, message, path }` responses (a Zod rejection reports
      // where it failed) take precedence over the generic summary line.
      const serverMessage =
        body.message ?? nestedMessage ?? (typeof body.error === 'string' ? body.error : undefined);
      const key = code ? `api.${code}` : '';
      const translated = key ? t(key) : '';
      const message =
        translated && translated !== key ? translated : (serverMessage ?? t('err.generic'));
      throw new ApiError(message, res.status, code, body.path);
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
    /** Where a rejected document failed, as reported by the server. */
    public path?: string,
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

/** The server's durable sync-job states; the UI adds `bridge_offline` on top. */
export type SyncJobState = 'pending' | 'claimed' | 'synced' | 'conflict' | 'failed';

export interface JourneySyncRequest {
  jobId: string;
  state: SyncJobState;
}

export interface JourneySyncStatus {
  jobId: string;
  state: SyncJobState;
  requestedAt: string;
  completedAt: string | null;
  bridgeConnected: boolean;
}

/** The structured Daily projection PostgreSQL owns; never raw Markdown. */
export interface JourneyProjectionDaily {
  date: string;
  stage: string;
  tasks: JourneyTask[];
  evidence: string[];
  journal: JourneyJournal;
  blocks: JourneyBlock[];
}

/**
 * `GET /journey/today` answers differently per mode. Local vault mode returns
 * the `JourneySnapshot`; hosted mode returns the stored projection, or
 * `{ synced: false }` before the first successful synchronization. Hosted
 * answers carry `bridgeConnected` so the UI can reconcile on load instead of
 * assuming the bridge is away.
 */
export type JourneyTodayResponse =
  | JourneySnapshot
  | { synced: false; bridgeConnected?: boolean }
  | {
      synced: true;
      date: string;
      revision: string;
      updatedAt?: string;
      bridgeConnected?: boolean;
      projection: { daily: JourneyProjectionDaily };
    };

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
    today: () => apiRequest<JourneyTodayResponse>('/journey/today'),

    /**
     * Explicitly asks the local HeheVault bridge to reconcile the vault with
     * PostgreSQL. Durable on the server, so it survives an offline bridge.
     */
    requestSync: (eventId: string) =>
      apiRequest<JourneySyncRequest>('/journey/sync', {
        method: 'POST',
        headers: { 'Idempotency-Key': eventId },
        body: JSON.stringify({}),
      }),

    /** Status of a job this client explicitly requested. Never polls a job it did not ask for. */
    syncStatus: (jobId: string) =>
      apiRequest<JourneySyncStatus>(`/journey/sync/${encodeURIComponent(jobId)}`),

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

  admin: {
    stats: () => apiRequest<AdminStats>('/admin/stats'),

    listUsers: (search = '', limit = 25, offset = 0) =>
      apiRequest<{ total: number; items: AdminUserItem[] }>(
        `/admin/users?search=${encodeURIComponent(search)}&limit=${limit}&offset=${offset}`,
      ),

    patchUser: (id: string, patch: { role?: 'user' | 'admin'; disabled?: boolean }) =>
      apiRequest<void>(`/admin/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
  },

  review: {
    due: () => apiRequest<{ count: number; items: ReviewSchedule[] }>('/review/due'),

    grade: (topic: string, sectionIdx: number, questionIdx: number, quality: ReviewQuality) =>
      apiRequest<{ schedule: ReviewSchedule }>('/review/grade', {
        method: 'POST',
        body: JSON.stringify({ topic, sectionIdx, questionIdx, quality }),
      }),
  },

  libraryAdmin: {
    listTopics: (locale: AdminLocale, includeArchived = false) =>
      apiRequest<{ items: AdminTopicListItem[] }>(
        `/library/admin/topics?lang=${locale}${includeArchived ? '&includeArchived=1' : ''}`,
      ),

    getTopic: (id: string) =>
      apiRequest<AdminTopicDetail>(`/library/admin/topics/${encodeURIComponent(id)}`),

    createTopic: (input: {
      key: string;
      locale: AdminLocale;
      label: string;
      title: string;
      subtitle: string | null;
      color: string;
    }) =>
      apiRequest<{ id: string }>('/library/admin/topics', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    updateTopic: (
      id: string,
      patch: {
        label?: string;
        title?: string;
        subtitle?: string | null;
        color?: string;
        position?: number;
      },
    ) =>
      apiRequest<void>(`/library/admin/topics/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),

    archiveTopic: (id: string) =>
      apiRequest<{ snapshot: AdminDocument }>(
        `/library/admin/topics/${encodeURIComponent(id)}/archive`,
        { method: 'POST' },
      ),

    restoreTopic: (id: string) =>
      apiRequest<void>(`/library/admin/topics/${encodeURIComponent(id)}/restore`, {
        method: 'POST',
      }),

    exportTopic: (id: string) =>
      apiRequest<AdminDocument>(`/library/admin/topics/${encodeURIComponent(id)}/export`),

    importTopic: (id: string, mode: 'replace' | 'append', document: AdminDocument) =>
      apiRequest<{ sections: number; questions: number }>(
        `/library/admin/topics/${encodeURIComponent(id)}/import`,
        { method: 'POST', body: JSON.stringify({ mode, document }) },
      ),

    createSection: (topicId: string, name: string) =>
      apiRequest<{ id: string }>(`/library/admin/topics/${encodeURIComponent(topicId)}/sections`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),

    updateSection: (id: string, patch: { name?: string; position?: number }) =>
      apiRequest<void>(`/library/admin/sections/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),

    deleteSection: (id: string) =>
      apiRequest<{ snapshot: AdminDocument }>(`/library/admin/sections/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),

    createQuestion: (
      sectionId: string,
      input: {
        code: string | null;
        prompt: string;
        level: AdminLevel | null;
        blocks: AdminBlock[];
      },
    ) =>
      apiRequest<{ id: string }>(
        `/library/admin/sections/${encodeURIComponent(sectionId)}/questions`,
        { method: 'POST', body: JSON.stringify(input) },
      ),

    updateQuestion: (
      id: string,
      patch: {
        code?: string | null;
        prompt?: string;
        level?: AdminLevel | null;
        blocks?: AdminBlock[];
        position?: number;
      },
    ) =>
      apiRequest<void>(`/library/admin/questions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),

    deleteQuestion: (id: string) =>
      apiRequest<{ snapshot: AdminDocument }>(
        `/library/admin/questions/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      ),
  },
};

export interface AdminStats {
  totalUsers: number;
  totalAdmins: number;
  activeSessions: number;
  dailyCompletionsToday: number;
}

export interface AdminUserItem {
  id: string;
  email: string;
  displayName: string | null;
  role: 'user' | 'admin';
  disabled: boolean;
  emailVerifiedAt: string | null;
  lastSeenAt: string | null;
  providers: string[];
}

export type AdminLocale = 'vi' | 'en';
export type AdminLevel = 'basic' | 'intermediate' | 'advanced';

export type AdminBlock =
  | { type: 'text'; text: string }
  | { type: 'note'; text: string }
  | { type: 'code'; lang: string; text: string }
  | { type: 'table'; rows: string[][]; headerDone?: boolean; closed?: boolean };

export interface AdminTopicListItem {
  id: string;
  key: string;
  label: string;
  title: string;
  subtitle: string | null;
  color: string;
  position: number;
  archived: boolean;
  questionCount: number;
}

export interface AdminQuestion {
  id: string;
  position: number;
  code: string | null;
  prompt: string;
  level: AdminLevel | null;
  blocks: AdminBlock[];
}

export interface AdminSection {
  id: string;
  position: number;
  name: string;
  questions: AdminQuestion[];
}

export interface AdminTopicDetail {
  id: string;
  key: string;
  locale: AdminLocale;
  label: string;
  title: string;
  subtitle: string | null;
  color: string;
  position: number;
  archived: boolean;
  sections: AdminSection[];
}

/** The wire format `importTopic` accepts and `exportTopic` returns. */
export interface AdminDocument {
  title: string;
  subtitle: string | null;
  label: string;
  color: string;
  sections: Array<{
    name: string;
    questions: Array<{
      code: string | null;
      level: AdminLevel | null;
      q: string;
      blocks: AdminBlock[];
    }>;
  }>;
}
