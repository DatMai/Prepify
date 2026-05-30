const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

function token(): string | null {
  return localStorage.getItem('quiz:token');
}

function authHeaders(): HeadersInit {
  const t = token();
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { ...options, headers: { ...authHeaders(), ...options?.headers } });
  const json = await res.json() as T;
  if (!res.ok) throw new ApiError((json as { error?: string }).error ?? 'Request failed', res.status);
  return json;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
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
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export const api = {
  auth: {
    register: (email: string, password: string, displayName?: string) =>
      request<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName }),
      }),

    login: (email: string, password: string) =>
      request<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),

    me: () => request<AuthUser>('/auth/me'),

    updateProfile: (data: { displayName?: string; location?: string; avatarId?: number }) =>
      request<{ displayName: string | null; location: string | null; avatarId: number }>('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    resendVerification: () =>
      request<{ ok: boolean }>('/auth/resend-verification', { method: 'POST' }),

    setSecurityQuestion: (question: string, answer: string) =>
      request<{ ok: boolean }>('/auth/security-question/set', {
        method: 'POST',
        body: JSON.stringify({ question, answer }),
      }),

    forgotByEmail: (email: string) =>
      request<{ ok: boolean; message: string }>('/auth/forgot/email', {
        method: 'POST', body: JSON.stringify({ email }),
      }),

    forgotGetQuestion: (email: string) =>
      request<{ question: string }>('/auth/forgot/question', {
        method: 'POST', body: JSON.stringify({ email }),
      }),

    forgotVerifyQuestion: (email: string, answer: string) =>
      request<{ resetToken: string }>('/auth/forgot/question/verify', {
        method: 'POST', body: JSON.stringify({ email, answer }),
      }),

    resetPassword: (token: string, newPassword: string) =>
      request<{ ok: boolean }>('/auth/reset-password', {
        method: 'POST', body: JSON.stringify({ token, newPassword }),
      }),
  },

  progress: {
    get: () => request<{ data: Record<string, boolean> }>('/progress'),
    put: (data: Record<string, boolean>) =>
      request<{ ok: boolean }>('/progress', {
        method: 'PUT',
        body: JSON.stringify({ data }),
      }),
    patch: (key: string, value: boolean) =>
      request<{ ok: boolean }>('/progress', {
        method: 'PATCH',
        body: JSON.stringify({ key, value }),
      }),
  },
};
