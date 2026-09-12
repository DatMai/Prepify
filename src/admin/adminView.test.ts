import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminStats, AdminUserItem } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    admin: {
      stats: vi.fn(),
      listUsers: vi.fn(),
      patchUser: vi.fn(),
    },
  },
}));

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

function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const stats: AdminStats = {
  totalUsers: 10,
  totalAdmins: 2,
  activeSessions: 5,
  dailyCompletionsToday: 3,
};

const user: AdminUserItem = {
  id: 'user-1',
  email: '<img src=x onerror=alert(1)>',
  displayName: 'User One',
  role: 'user',
  disabled: false,
  emailVerifiedAt: null,
  lastSeenAt: '2026-09-12T09:00:00.000Z',
  providers: ['google'],
};

describe('adminView', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
    document.body.innerHTML = '';
  });

  it('renders stat cards and escapes user emails', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.admin.stats).mockResolvedValue(stats);
    vi.mocked(api.admin.listUsers).mockResolvedValue({ total: 1, items: [user] });

    const { openAdmin } = await import('./adminView');
    await openAdmin(false);
    await settled();
    await settled();

    expect(document.querySelector('.admin-stat-value')?.textContent).toBe('10');
    expect(document.body.textContent).toContain('User One');
    expect(document.querySelector('.admin-user-email')?.textContent).toContain('<img');
    expect(document.querySelector('.admin-user-email img')).toBeNull();
    expect(document.querySelector('.admin-table')).not.toBeNull();
  });

  it('calls patchUser with a disable patch when toggled', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.admin.stats).mockResolvedValue(stats);
    vi.mocked(api.admin.listUsers).mockResolvedValue({ total: 1, items: [user] });
    vi.mocked(api.admin.patchUser).mockResolvedValue(undefined);

    const { openAdmin } = await import('./adminView');
    await openAdmin(false);
    await settled();
    await settled();

    (document.querySelector('.admin-action-danger') as HTMLButtonElement).click();
    await settled();
    await settled();

    expect(api.admin.patchUser).toHaveBeenCalledWith('user-1', { disabled: true });
  });
});
