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

const { todayMock, requestSyncMock, syncStatusMock } = vi.hoisted(() => ({
  todayMock: vi.fn(),
  requestSyncMock: vi.fn(),
  syncStatusMock: vi.fn(),
}));

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ApiError: actual.ApiError,
    api: {
      journey: {
        today: todayMock,
        requestSync: requestSyncMock,
        syncStatus: syncStatusMock,
        addEvidence: vi.fn(),
        saveJournal: vi.fn(),
      },
    },
  };
});

function hostedToday({ bridgeConnected = true }: { bridgeConnected?: boolean } = {}) {
  return {
    synced: true,
    date: '2026-09-13',
    revision: 'a'.repeat(64),
    updatedAt: '2026-09-13T09:00:00.000Z',
    bridgeConnected,
    projection: {
      daily: {
        date: '2026-09-13',
        stage: 'Deep Work',
        tasks: [{ id: 't1', checked: false, text: 'Read a paper', tags: [] }],
        evidence: [],
        journal: { done: '', blocked: '', next: '' },
      },
    },
  };
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    jobId: 'job-1',
    state: 'pending',
    requestedAt: '2026-09-13T08:59:00.000Z',
    completedAt: null,
    bridgeConnected: true,
    ...overrides,
  };
}

const settled = async (times = 4): Promise<void> => {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

async function open() {
  const { auth } = await import('../state/auth');
  auth.user = { id: 'u1', email: 'owner@example.com', displayName: null, role: 'admin' };
  const view = await import('./journeyView');
  await view.openJourney(false);
  return view;
}

function syncControlState(): string | null {
  return document.querySelector('.journey-sync-control')?.getAttribute('data-state') ?? null;
}

describe('journeyView sync control', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
    todayMock.mockReset();
    requestSyncMock.mockReset();
    syncStatusMock.mockReset();
  });

  it('normalizes the hosted projection and treats a missing projection as empty', async () => {
    const { normalizeJourneyToday } = await import('./journeyView');

    expect(normalizeJourneyToday({ synced: false })).toBeNull();

    const model = normalizeJourneyToday(hostedToday() as never);
    expect(model?.hosted).toBe(true);
    expect(model?.writable).toBe(true);
    expect(model?.projectionUpdatedAt).toBe('2026-09-13T09:00:00.000Z');
    expect(model?.date).toBe('2026-09-13');
    expect(model?.revision).toBe('a'.repeat(64));
    expect(model?.tasks).toHaveLength(1);
    expect(model?.obsidianUri).toBeNull();
    expect(model?.mtimeMs).toBeNull();
  });

  it('treats a stored projection as synced while the bridge is connected', async () => {
    todayMock.mockResolvedValue(hostedToday());
    await open();

    expect(syncControlState()).toBe('synced');
    expect(document.body.textContent).toContain('Read a paper');
    const complete = document.querySelector<HTMLButtonElement>('.journey-btn-primary');
    expect(complete?.disabled).toBe(false);
  });

  it('reports bridge_offline and locks writes when the bridge is away', async () => {
    todayMock.mockResolvedValue(hostedToday({ bridgeConnected: false }));
    await open();

    expect(syncControlState()).toBe('bridge_offline');
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('[data-requires-sync]')].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
  });

  it('prompts the user to sync when no projection exists yet', async () => {
    todayMock.mockResolvedValue({ synced: false });
    await open();

    expect(document.querySelector('.journey-empty-state')).not.toBeNull();
    expect(document.querySelector('#journeySyncBtn')).not.toBeNull();
    expect(syncControlState()).toBe('pending');
  });

  it('requests a sync, reports bridge_offline, and disables mutations', async () => {
    todayMock.mockResolvedValue(hostedToday());
    requestSyncMock.mockResolvedValue({ jobId: 'job-1', state: 'pending' });
    syncStatusMock.mockResolvedValue(status({ bridgeConnected: false }));
    await open();

    document.querySelector<HTMLButtonElement>('#journeySyncBtn')!.click();
    await settled();

    expect(requestSyncMock).toHaveBeenCalledTimes(1);
    expect(syncStatusMock).toHaveBeenCalledWith('job-1');
    expect(syncControlState()).toBe('bridge_offline');
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('.journey-btn-primary')].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    expect(document.querySelector('#journeySyncRetry')).not.toBeNull();
  });

  it('does not run a mutation when the sync state is offline', async () => {
    todayMock.mockResolvedValue(hostedToday({ bridgeConnected: false }));
    await open();

    const { runMutation } = await import('./journeyView');
    const work = vi.fn().mockResolvedValue(undefined);
    runMutation(work, 'saved');
    await settled();

    expect(work).not.toHaveBeenCalled();
  });

  it('keeps conflict state and mutation gating after reloading the projection', async () => {
    todayMock.mockResolvedValue(hostedToday());
    requestSyncMock.mockResolvedValue({ jobId: 'job-1', state: 'pending' });
    syncStatusMock.mockResolvedValue(status({ state: 'conflict' }));
    await open();

    document.querySelector<HTMLButtonElement>('#journeySyncBtn')!.click();
    await settled();
    document.querySelector<HTMLButtonElement>('.journey-reload-btn')!.click();
    await settled();

    expect(syncControlState()).toBe('conflict');
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('[data-requires-sync]')].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
  });

  it('surfaces conflict guidance and keeps mutations disabled', async () => {
    todayMock.mockResolvedValue(hostedToday());
    requestSyncMock.mockResolvedValue({ jobId: 'job-1', state: 'pending' });
    syncStatusMock.mockResolvedValue(status({ state: 'conflict' }));
    await open();

    document.querySelector<HTMLButtonElement>('#journeySyncBtn')!.click();
    await settled();

    expect(syncControlState()).toBe('conflict');
    expect(document.querySelector('.journey-sync-hint')?.textContent?.trim()).not.toBe('');
    expect(document.querySelector<HTMLButtonElement>('.journey-btn-primary')?.disabled).toBe(true);
  });

  it('reloads the projection and re-enables mutations after a successful sync', async () => {
    todayMock.mockResolvedValue(hostedToday());
    requestSyncMock.mockResolvedValue({ jobId: 'job-1', state: 'pending' });
    syncStatusMock.mockResolvedValue(
      status({ state: 'synced', completedAt: '2026-09-13T09:00:00.000Z' }),
    );
    await open();

    document.querySelector<HTMLButtonElement>('#journeySyncBtn')!.click();
    await settled();

    expect(todayMock).toHaveBeenCalledTimes(2);
    expect(syncControlState()).toBe('synced');
    expect(document.querySelector('.journey-sync-last')?.textContent?.trim()).not.toBe('');
    expect(document.querySelector<HTMLButtonElement>('.journey-btn-primary')?.disabled).toBe(false);
  });
});
