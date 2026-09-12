import { api, type AuthUser } from '../api/client';

export interface AuthState {
  user: AuthUser | null;
}

export const auth: AuthState = {
  user: null,
};

export function isLoggedIn(): boolean {
  return auth.user !== null;
}

export function setSession(user: AuthUser): void {
  auth.user = user;
}

export function clearSession(): void {
  auth.user = null;
}

export async function restoreSession(): Promise<void> {
  try {
    const session = await api.auth.session();
    auth.user = session.user;
  } catch {
    clearSession();
  }
}
