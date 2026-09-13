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

const { fetchStatusMock, fetchQuestionsMock, completeMock, requestSyncMock, syncStatusMock } =
  vi.hoisted(() => ({
    fetchStatusMock: vi.fn(),
    fetchQuestionsMock: vi.fn(),
    completeMock: vi.fn(),
    requestSyncMock: vi.fn(),
    syncStatusMock: vi.fn(),
  }));

vi.mock('../api/streak', () => ({
  fetchDailyStatus: fetchStatusMock,
  fetchDailyQuestions: fetchQuestionsMock,
  completeDailyChallenge: completeMock,
}));

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ApiError: actual.ApiError,
    api: {
      journey: {
        requestSync: requestSyncMock,
        syncStatus: syncStatusMock,
      },
    },
  };
});

const settled = async (times = 4): Promise<void> => {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

async function open() {
  const { auth } = await import('../state/auth');
  auth.user = { id: 'u1', email: 'owner@example.com', displayName: null, role: 'admin' };
  const view = await import('./dailyView');
  await view.openDaily();
  return view;
}

describe('dailyView sync control', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
    document.body.innerHTML = '';
    fetchStatusMock.mockReset();
    fetchQuestionsMock.mockReset();
    completeMock.mockReset();
    requestSyncMock.mockReset();
    syncStatusMock.mockReset();
  });

  it('keeps the database-owned quiz usable while the bridge is offline', async () => {
    fetchStatusMock.mockResolvedValue({ completedToday: false });
    fetchQuestionsMock.mockResolvedValue({
      date: '2026-09-13',
      challenge: 'challenge',
      questions: [{ id: 'q1', type: 'fib', prompt: 'A ___ is a test.', blankCount: 1 }],
    });
    requestSyncMock.mockResolvedValue({ jobId: 'job-1', state: 'pending' });
    syncStatusMock.mockResolvedValue({
      jobId: 'job-1',
      state: 'pending',
      requestedAt: '2026-09-13T08:59:00.000Z',
      completedAt: null,
      bridgeConnected: false,
    });

    await open();

    const next = document.querySelector<HTMLButtonElement>('#dailyNext');
    expect(next).not.toBeNull();
    expect(document.querySelector('.daily-card-area')).not.toBeNull();
    expect(document.querySelector('.daily-sync')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('#dailySyncBtn')!.click();
    await settled();

    expect(requestSyncMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.daily-sync')?.getAttribute('data-state')).toBe(
      'bridge_offline',
    );
    expect(document.querySelector<HTMLButtonElement>('#dailySyncRetry')?.hidden).toBe(false);
    // Gating only touches vault-backed mutations; the quiz itself keeps working.
    expect(document.querySelector('#dailyNext')).not.toBeNull();
    expect(document.querySelector('.daily-card-area')).not.toBeNull();
  });

  it('shows the last successful sync time and the synced state', async () => {
    fetchStatusMock.mockResolvedValue({ completedToday: false });
    fetchQuestionsMock.mockResolvedValue({
      date: '2026-09-13',
      challenge: 'challenge',
      questions: [{ id: 'q1', type: 'fib', prompt: 'A ___ is a test.', blankCount: 1 }],
    });

    await open();

    expect(document.querySelector('.daily-sync-state')?.textContent?.trim()).not.toBe('');
    expect(document.querySelector('.daily-sync')?.getAttribute('aria-live')).toBeNull();
    expect(document.querySelector('.daily-sync-state')?.getAttribute('aria-live')).toBe('polite');
  });

  it('groups the sync action with its current status', async () => {
    fetchStatusMock.mockResolvedValue({ completedToday: false });
    fetchQuestionsMock.mockResolvedValue({
      date: '2026-09-13',
      challenge: 'challenge',
      questions: [{ id: 'q1', type: 'fib', prompt: 'A ___ is a test.', blankCount: 1 }],
    });

    await open();

    const toolbar = document.querySelector('.daily-sync-toolbar');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.querySelector('#dailySyncBtn')).not.toBeNull();
    expect(toolbar?.querySelector('.daily-sync-meta')).not.toBeNull();
  });
});
