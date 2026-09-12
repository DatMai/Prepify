import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminStats, AdminUserItem } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    admin: {
      stats: vi.fn(),
      listUsers: vi.fn(),
      patchUser: vi.fn(),
    },
    libraryAdmin: {
      listTopics: vi.fn(),
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

describe('adminView tabs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
    document.body.innerHTML = '';
  });

  it('opens on the dashboard and shows the stat cards', async () => {
    const { api } = await import('../api/client');
    const { t } = await import('../i18n');
    vi.mocked(api.admin.stats).mockResolvedValue(stats);

    const { openAdmin } = await import('./adminView');
    await openAdmin(false);
    await settled();

    expect(document.querySelector('.admin-tab.is-active')?.textContent).toBe(
      t('admin.tabDashboard'),
    );
    expect(document.querySelector('.admin-stat-value')?.textContent).toBe('10');
  });

  it('does not load users until the users tab is opened', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.admin.stats).mockResolvedValue(stats);
    vi.mocked(api.admin.listUsers).mockResolvedValue({ total: 1, items: [user] });

    const { openAdmin, setAdminTab } = await import('./adminView');
    await openAdmin(false);
    await settled();
    expect(api.admin.listUsers).not.toHaveBeenCalled();

    setAdminTab('users');
    await settled();
    await settled();

    expect(api.admin.listUsers).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('User One');
  });

  it('renders a user email as text, never as markup', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.admin.stats).mockResolvedValue(stats);
    vi.mocked(api.admin.listUsers).mockResolvedValue({ total: 1, items: [user] });

    const { openAdmin, setAdminTab } = await import('./adminView');
    await openAdmin(false);
    setAdminTab('users');
    await settled();
    await settled();

    expect(document.querySelector('.admin-user-email')?.textContent).toContain('<img');
    expect(document.querySelector('.admin-user-email img')).toBeNull();
    expect(document.querySelector('.admin-table')).not.toBeNull();
  });

  it('patches a user when the disable action is clicked', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.admin.stats).mockResolvedValue(stats);
    vi.mocked(api.admin.listUsers).mockResolvedValue({ total: 1, items: [user] });
    vi.mocked(api.admin.patchUser).mockResolvedValue(undefined);

    const { openAdmin, setAdminTab } = await import('./adminView');
    await openAdmin(false);
    setAdminTab('users');
    await settled();
    await settled();

    (document.querySelector('.admin-action-danger') as HTMLButtonElement).click();
    await settled();
    await settled();

    expect(api.admin.patchUser).toHaveBeenCalledWith('user-1', { disabled: true });
  });

  it('renders three tabs and keeps the dashboard on the repaint path', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.admin.stats).mockResolvedValue(stats);

    const { openAdmin, repaintAdmin } = await import('./adminView');
    await openAdmin(false);
    await settled();
    repaintAdmin();
    await settled();

    expect(document.querySelectorAll('.admin-tab')).toHaveLength(3);
    expect(document.querySelector('.admin-stat-value')?.textContent).toBe('10');
  });

  it('asks the registered renderer for the content tab', async () => {
    const { openAdmin, setAdminTab, setContentTabRenderer } = await import('./adminView');
    await openAdmin(false);

    // Registered after init, because initAdminView wires the real content tab.
    const renderer = vi.fn();
    setContentTabRenderer(renderer);
    setAdminTab('content');

    expect(renderer).toHaveBeenCalledTimes(1);
    expect(renderer.mock.calls[0]?.[0]).toBe(document.getElementById('adminTabBody'));
  });

  it('delegates the content tab to the subject list', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.admin.stats).mockResolvedValue(stats);
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [] });

    const { openAdmin, setAdminTab } = await import('./adminView');
    await openAdmin(false);
    setAdminTab('content');
    await settled();
    await settled();

    expect(api.libraryAdmin.listTopics).toHaveBeenCalledWith('vi', true);
    expect(document.querySelector('.la-topics')).not.toBeNull();
  });

  it('marks the clicked tab as active', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.admin.stats).mockResolvedValue(stats);

    const { openAdmin } = await import('./adminView');
    await openAdmin(false);
    await settled();

    const contentTab = document.querySelector('[data-tab="content"]') as HTMLButtonElement;
    contentTab.click();

    expect(contentTab.classList.contains('is-active')).toBe(true);
    expect(document.querySelector('.admin-stat-value')).toBeNull();
  });
});
