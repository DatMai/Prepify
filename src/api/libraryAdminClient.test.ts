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

describe('library admin client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', memoryStorage());
  });

  function respondingJson(body: unknown, status = 200) {
    // a fresh Response per call: a body can only be read once
    return vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
  }

  it('requests the admin topic list for a locale, including archived subjects', async () => {
    const { api } = await import('./client');
    const fetchMock = respondingJson({ items: [] });

    await api.libraryAdmin.listTopics('en', true);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3001/api/v1/library/admin/topics?lang=en&includeArchived=1',
    );
  });

  it('omits the archived flag when it is not requested', async () => {
    const { api } = await import('./client');
    const fetchMock = respondingJson({ items: [] });

    await api.libraryAdmin.listTopics('vi');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3001/api/v1/library/admin/topics?lang=vi',
    );
  });

  it('sends a topic create with every field', async () => {
    const { api } = await import('./client');
    const fetchMock = respondingJson({ id: 't-1' }, 201);

    await api.libraryAdmin.createTopic({
      key: 'system-design',
      locale: 'vi',
      label: 'System Design',
      title: 'System Design',
      subtitle: null,
      color: '#123456',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3001/api/v1/library/admin/topics');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      key: 'system-design',
      locale: 'vi',
      label: 'System Design',
      title: 'System Design',
      subtitle: null,
      color: '#123456',
    });
  });

  it('patches a question with only the level change', async () => {
    const { api } = await import('./client');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await api.libraryAdmin.updateQuestion('q-1', { level: 'advanced' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3001/api/v1/library/admin/questions/q-1',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ level: 'advanced' }));
  });

  it('treats a null level as a real value, not an omission', async () => {
    const { api } = await import('./client');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await api.libraryAdmin.updateQuestion('q-1', { level: null });

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ level: null }));
  });

  it('returns the snapshot body from a section delete', async () => {
    const { api } = await import('./client');
    const snapshot = { title: 'T', subtitle: null, label: 'L', color: '#000000', sections: [] };
    respondingJson({ snapshot });

    const result = await api.libraryAdmin.deleteSection('s-1');

    expect(result).toEqual({ snapshot });
  });

  it('imports a document with an explicit mode', async () => {
    const { api } = await import('./client');
    const fetchMock = respondingJson({ sections: 1, questions: 2 });

    await api.libraryAdmin.importTopic('t-1', 'replace', {
      title: 'T',
      subtitle: null,
      label: 'L',
      color: '#000000',
      sections: [],
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3001/api/v1/library/admin/topics/t-1/import',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      mode: 'replace',
    });
  });

  it('encodes ids in the path', async () => {
    const { api } = await import('./client');
    const fetchMock = respondingJson({ items: [] });

    await api.libraryAdmin.getTopic('id with space');
    await api.libraryAdmin.createSection('id with space', 'Phần I');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3001/api/v1/library/admin/topics/id%20with%20space',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://localhost:3001/api/v1/library/admin/topics/id%20with%20space/sections',
    );
  });

  it('surfaces the server validation path on a rejected import', async () => {
    const { api, ApiError } = await import('./client');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Invalid document',
          code: 'library_invalid_document',
          path: 'document.sections[0].questions[0].blocks[0].type',
          message: 'Invalid input',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      api.libraryAdmin.importTopic('t-1', 'replace', {
        title: 'T',
        subtitle: null,
        label: 'L',
        color: '#000000',
        sections: [],
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('keeps the server message and path for a rejected document', async () => {
    const { api, ApiError } = await import('./client');
    respondingJson(
      {
        error: 'Invalid document',
        code: 'library_invalid_document',
        path: 'document.sections[0].questions[0].blocks[0].type',
        message: 'Invalid input',
      },
      400,
    );

    const failure = await api.libraryAdmin
      .importTopic('t-1', 'replace', {
        title: 'T',
        subtitle: null,
        label: 'L',
        color: '#000000',
        sections: [],
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code: 'library_invalid_document',
      message: 'Invalid input',
      path: 'document.sections[0].questions[0].blocks[0].type',
    });
  });
});
