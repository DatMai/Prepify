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

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3001/api/v1/auth/session');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('fetches the public feed with a default limit', async () => {
    const { api } = await import('./client');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await api.feed.list();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3001/api/v1/feed?limit=30');
  });

  it('lists admin users with an encoded search term', async () => {
    const { api } = await import('./client');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ total: 0, items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await api.admin.listUsers('a b', 10, 5);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3001/api/v1/admin/users?search=a%20b&limit=10&offset=5',
    );
  });

  it('patches a user with a role change', async () => {
    const { api } = await import('./client');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await api.admin.patchUser('user-1', { role: 'admin' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3001/api/v1/admin/users/user-1');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ role: 'admin' }));
  });

  it('fetches the due review queue', async () => {
    const { api } = await import('./client');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ count: 0, items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await api.review.due();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3001/api/v1/review/due');
  });

  it('grades a review card', async () => {
    const { api } = await import('./client');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          schedule: {
            topic: 'javascript',
            sectionIdx: 0,
            questionIdx: 1,
            intervalDays: 7,
            ease: 2.55,
            reviewCount: 1,
            dueAt: '2026-09-19T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await api.review.grade('javascript', 0, 1, 'good');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:3001/api/v1/review/grade');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      topic: 'javascript',
      sectionIdx: 0,
      questionIdx: 1,
      quality: 'good',
    });
  });
});
