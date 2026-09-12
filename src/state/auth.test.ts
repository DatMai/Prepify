import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../api/client';

const user: AuthUser = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'User',
  role: 'user',
};

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('auth state', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
  });

  it('keeps identity in memory without reading or writing credentials in localStorage', async () => {
    const getItem = vi.spyOn(localStorage, 'getItem');
    const setItem = vi.spyOn(localStorage, 'setItem');
    const removeItem = vi.spyOn(localStorage, 'removeItem');
    const { auth, setSession, clearSession } = await import('./auth');

    setSession(user);
    expect(auth.user).toEqual(user);
    clearSession();
    expect(auth.user).toBeNull();

    expect(getItem).not.toHaveBeenCalledWith('quiz:token');
    expect(setItem).not.toHaveBeenCalledWith('quiz:token', expect.anything());
    expect(removeItem).not.toHaveBeenCalledWith('quiz:token');
  });
});
