import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminTopicListItem } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    libraryAdmin: {
      listTopics: vi.fn(),
      getTopic: vi.fn(),
      createTopic: vi.fn(),
      archiveTopic: vi.fn(),
      restoreTopic: vi.fn(),
      exportTopic: vi.fn(),
      importTopic: vi.fn(),
      createSection: vi.fn(),
      updateSection: vi.fn(),
      deleteSection: vi.fn(),
      createQuestion: vi.fn(),
      updateQuestion: vi.fn(),
      deleteQuestion: vi.fn(),
    },
  },
}));

const topic: AdminTopicListItem = {
  id: 't-1',
  key: 'dsa',
  label: 'DSA',
  title: 'Data Structures',
  subtitle: null,
  color: '#B71C1C',
  position: 0,
  archived: false,
  questionCount: 58,
};

function mount(): HTMLElement {
  const body = document.createElement('div');
  document.body.appendChild(body);
  return body;
}

function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

describe('content tab', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
    document.body.innerHTML = '';
  });

  it('lists subjects with their question count and requests the active locale', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
    const { renderContentTab } = await import('./libraryAdminView');

    renderContentTab(mount());
    await settled();
    await settled();

    expect(api.libraryAdmin.listTopics).toHaveBeenCalledWith('vi', true);
    expect(document.querySelector('.la-topic-key')?.textContent).toBe('dsa');
    expect(document.body.textContent).toContain('58');
  });

  it('reloads the list when the locale switches', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [] });
    const { renderContentTab, setContentLocale } = await import('./libraryAdminView');

    renderContentTab(mount());
    setContentLocale('en');
    await settled();

    expect(api.libraryAdmin.listTopics).toHaveBeenLastCalledWith('en', true);
  });

  it('creates a subject with the form values and then reloads', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [] });
    vi.mocked(api.libraryAdmin.createTopic).mockResolvedValue({ id: 't-2' });
    const { renderContentTab } = await import('./libraryAdminView');

    renderContentTab(mount());
    await settled();
    (document.querySelector('.la-new-topic') as HTMLButtonElement).click();
    await settled();

    (document.querySelector('[name="key"]') as HTMLInputElement).value = 'system-design';
    (document.querySelector('[name="label"]') as HTMLInputElement).value = 'System Design';
    (document.querySelector('[name="title"]') as HTMLInputElement).value = 'System Design';
    (document.querySelector('[name="color"]') as HTMLInputElement).value = '#123456';
    (document.querySelector('.la-create-submit') as HTMLButtonElement).click();
    await settled();
    await settled();

    expect(api.libraryAdmin.createTopic).toHaveBeenCalledWith({
      key: 'system-design',
      locale: 'vi',
      label: 'System Design',
      title: 'System Design',
      subtitle: null,
      color: '#123456',
    });
    expect(api.libraryAdmin.listTopics).toHaveBeenCalledTimes(2);
  });

  it('does not create anything when the form is incomplete', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [] });
    const { renderContentTab } = await import('./libraryAdminView');

    renderContentTab(mount());
    await settled();
    (document.querySelector('.la-new-topic') as HTMLButtonElement).click();
    await settled();
    (document.querySelector('.la-create-submit') as HTMLButtonElement).click();
    await settled();

    expect(api.libraryAdmin.createTopic).not.toHaveBeenCalled();
    expect(document.querySelector('.la-form-error')?.textContent).toBeTruthy();
  });

  it('archives after confirmation and downloads the snapshot', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
    vi.mocked(api.libraryAdmin.archiveTopic).mockResolvedValue({
      snapshot: { title: 'T', subtitle: null, label: 'L', color: '#000000', sections: [] },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { renderContentTab, setSnapshotDownloader } = await import('./libraryAdminView');
    const download = vi.fn();
    setSnapshotDownloader(download);

    renderContentTab(mount());
    await settled();
    await settled();
    (document.querySelector('.la-archive') as HTMLButtonElement).click();
    await settled();
    await settled();

    expect(api.libraryAdmin.archiveTopic).toHaveBeenCalledWith('t-1');
    expect(download).toHaveBeenCalledWith('dsa.json', expect.any(Object));
  });

  it('does nothing when the confirmation is declined', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { renderContentTab } = await import('./libraryAdminView');

    renderContentTab(mount());
    await settled();
    await settled();
    (document.querySelector('.la-archive') as HTMLButtonElement).click();
    await settled();

    expect(api.libraryAdmin.archiveTopic).not.toHaveBeenCalled();
  });

  it('marks an archived subject and offers restore instead', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({
      items: [{ ...topic, archived: true }],
    });
    const { renderContentTab } = await import('./libraryAdminView');

    renderContentTab(mount());
    await settled();
    await settled();

    expect(document.querySelector('.la-badge-archived')?.textContent).toBeTruthy();
    expect(document.querySelector('.la-restore')).not.toBeNull();
    expect(document.querySelector('.la-archive')).toBeNull();
  });
});
