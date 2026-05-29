import { api, type AuthUser } from '../api/client';

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
}

export const auth: AuthState = {
  user: null,
  token: localStorage.getItem('quiz:token'),
};

export function isLoggedIn(): boolean {
  return auth.token !== null && auth.user !== null;
}

export function setSession(token: string, user: AuthUser): void {
  auth.token = token;
  auth.user = user;
  localStorage.setItem('quiz:token', token);
}

export function clearSession(): void {
  auth.token = null;
  auth.user = null;
  localStorage.removeItem('quiz:token');
}

export async function restoreSession(): Promise<void> {
  if (!auth.token) return;
  try {
    auth.user = await api.auth.me();
  } catch {
    clearSession();
  }
}
