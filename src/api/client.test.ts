import { beforeEach, describe, expect, it, vi } from 'vitest';

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
describe('API client authentication', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', memoryStorage());
  });

  it('uses browser-managed credentials without an Authorization header', async () => {
    const { api } = await import('./client');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: 'user-1',
            email: 'user@example.com',
            displayName: null,
            role: 'user',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await api.auth.login('user@example.com', 'StrongPass1!');

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });

  it('calls the revocable server session endpoint on logout', async () => {
    const { api } = await import('./client');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await api.auth.logout();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3001/auth/session');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });
});
