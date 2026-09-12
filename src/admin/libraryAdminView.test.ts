import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminTopicDetail, AdminTopicListItem } from '../api/client';

// `ApiError` stays real so the dialog's `instanceof` check sees the same class.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: {
      admin: {
        stats: vi.fn(),
        listUsers: vi.fn(),
        patchUser: vi.fn(),
      },
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
  };
});

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

const detail: AdminTopicDetail = {
  id: 't-1',
  key: 'dsa',
  locale: 'vi',
  label: 'DSA',
  title: 'Data Structures',
  subtitle: null,
  color: '#B71C1C',
  position: 0,
  archived: false,
  sections: [
    {
      id: 's-1',
      position: 0,
      name: 'Phần I',
      questions: [
        { id: 'q-1', position: 0, code: 'Q1', prompt: 'Array là gì?', level: 'basic', blocks: [] },
        { id: 'q-2', position: 1, code: 'Q2', prompt: 'Linked list?', level: null, blocks: [] },
      ],
    },
  ],
};

async function openEditor(api: typeof import('../api/client').api): Promise<void> {
  vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
  vi.mocked(api.libraryAdmin.getTopic).mockResolvedValue(detail);
  const { renderContentTab } = await import('./libraryAdminView');

  renderContentTab(mount());
  await settled();
  await settled();
  (document.querySelector('.la-edit') as HTMLButtonElement).click();
  await settled();
  await settled();
}

describe('topic editor', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
    document.body.innerHTML = '';
  });

  it('opens pinned to one topic and renders its sections and questions', async () => {
    const { api } = await import('../api/client');
    await openEditor(api);

    expect(api.libraryAdmin.getTopic).toHaveBeenCalledWith('t-1');
    expect(document.querySelector('.la-section-name')?.textContent).toBe('Phần I');
    expect(document.querySelectorAll('.la-question')).toHaveLength(2);
    expect(document.body.textContent).toContain('Array là gì?');
  });

  it('sends a level change for one question only', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.updateQuestion).mockResolvedValue(undefined);
    await openEditor(api);

    const select = document.querySelector(
      '.la-question[data-question="q-2"] .la-level',
    ) as HTMLSelectElement;
    select.value = 'intermediate';
    select.dispatchEvent(new Event('change'));
    await settled();

    expect(api.libraryAdmin.updateQuestion).toHaveBeenCalledWith('q-2', { level: 'intermediate' });
  });

  it('never renumbers a question unless the move is confirmed', async () => {
    const { api } = await import('../api/client');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openEditor(api);

    (
      document.querySelector('.la-question[data-question="q-2"] .la-move-up') as HTMLButtonElement
    ).click();
    await settled();

    expect(api.libraryAdmin.updateQuestion).not.toHaveBeenCalled();
  });

  it('moves a question to the previous index when confirmed', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.updateQuestion).mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openEditor(api);

    (
      document.querySelector('.la-question[data-question="q-2"] .la-move-up') as HTMLButtonElement
    ).click();
    await settled();

    expect(api.libraryAdmin.updateQuestion).toHaveBeenCalledWith('q-2', { position: 0 });
  });

  it('disables the edge move buttons so a no-op move cannot be sent', async () => {
    const { api } = await import('../api/client');
    await openEditor(api);

    const first = document.querySelector(
      '.la-question[data-question="q-1"] .la-move-up',
    ) as HTMLButtonElement;
    const last = document.querySelector(
      '.la-question[data-question="q-2"] .la-move-down',
    ) as HTMLButtonElement;
    const secondDown = document.querySelector(
      '.la-question[data-question="q-1"] .la-move-down',
    ) as HTMLButtonElement;

    expect(first.disabled).toBe(true);
    expect(last.disabled).toBe(true);
    expect(secondDown.disabled).toBe(false);
  });

  it('deletes a question and downloads the snapshot, but only after confirmation', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.deleteQuestion).mockResolvedValue({
      snapshot: { title: 'T', subtitle: null, label: 'L', color: '#000000', sections: [] },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { setSnapshotDownloader } = await import('./libraryAdminView');
    const download = vi.fn();
    setSnapshotDownloader(download);

    await openEditor(api);

    (
      document.querySelector('.la-question[data-question="q-1"] .la-delete') as HTMLButtonElement
    ).click();
    await settled();
    await settled();

    expect(api.libraryAdmin.deleteQuestion).toHaveBeenCalledWith('q-1');
    expect(download).toHaveBeenCalledWith('dsa.json', expect.any(Object));
  });

  it('offers a new-question button per section that opens an empty editor', async () => {
    const { api } = await import('../api/client');
    await openEditor(api);

    (document.querySelector('.la-new-question') as HTMLButtonElement).click();
    await settled();

    expect(document.querySelector('.qe-panel')).not.toBeNull();
    expect(document.querySelector('[name="prompt"]')).toHaveProperty('value', '');
  });

  it('archives from inside the editor and goes back to the list', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.archiveTopic).mockResolvedValue({
      snapshot: { title: 'T', subtitle: null, label: 'L', color: '#000000', sections: [] },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { setSnapshotDownloader } = await import('./libraryAdminView');
    const download = vi.fn();
    setSnapshotDownloader(download);

    await openEditor(api);
    (document.querySelector('.la-archive') as HTMLButtonElement).click();
    await settled();
    await settled();

    expect(api.libraryAdmin.archiveTopic).toHaveBeenCalledWith('t-1');
    expect(download).toHaveBeenCalledWith('dsa.json', expect.any(Object));
    expect(document.querySelector('.la-editor')).toBeNull();
    expect(api.libraryAdmin.listTopics).toHaveBeenCalledTimes(2);
  });

  it('adds a section through the API and reloads the editor', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.createSection).mockResolvedValue({ id: 's-2' });
    await openEditor(api);

    (document.querySelector('.la-new-section') as HTMLButtonElement).click();
    await settled();
    (document.querySelector('[name="sectionName"]') as HTMLInputElement).value = 'Phần II';
    (document.querySelector('.la-section-submit') as HTMLButtonElement).click();
    await settled();
    await settled();

    expect(api.libraryAdmin.createSection).toHaveBeenCalledWith('t-1', 'Phần II');
    expect(api.libraryAdmin.getTopic).toHaveBeenCalledTimes(2);
  });
});

describe('parseImportDocument', () => {
  const valid = {
    title: 'T',
    subtitle: null,
    label: 'L',
    color: '#000000',
    sections: [
      {
        name: 'S',
        questions: [
          { code: 'Q1', level: 'basic', q: 'one', blocks: [{ type: 'text', text: 'a' }] },
        ],
      },
    ],
  };

  it('accepts a document and counts its content', async () => {
    const { parseImportDocument } = await import('./libraryAdminView');
    const result = parseImportDocument(JSON.stringify(valid));

    expect(result).toMatchObject({ ok: true, sections: 1, questions: 1 });
  });

  it('reports invalid JSON with the parser message', async () => {
    const { parseImportDocument } = await import('./libraryAdminView');
    const result = parseImportDocument('{ not json');

    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('message');
  });

  it('rejects a document that is missing required fields', async () => {
    const { parseImportDocument } = await import('./libraryAdminView');

    expect(parseImportDocument(JSON.stringify({ title: 'T' })).ok).toBe(false);
    expect(parseImportDocument(JSON.stringify({ ...valid, color: 'red' })).ok).toBe(false);
    expect(parseImportDocument(JSON.stringify({ ...valid, sections: [] })).ok).toBe(false);
  });

  it('rejects a question with an unknown block type', async () => {
    const { parseImportDocument } = await import('./libraryAdminView');
    const broken = {
      ...valid,
      sections: [{ name: 'S', questions: [{ q: 'x', blocks: [{ type: 'image' }] }] }],
    };

    expect(parseImportDocument(JSON.stringify(broken)).ok).toBe(false);
  });

  it('ships a sample template that parses', async () => {
    const { parseImportDocument, SAMPLE_DOCUMENT } = await import('./libraryAdminView');
    const result = parseImportDocument(JSON.stringify(SAMPLE_DOCUMENT));

    expect(result.ok).toBe(true);
  });

  it('returns the document it validated, so a round trip is lossless', async () => {
    const { parseImportDocument } = await import('./libraryAdminView');
    const result = parseImportDocument(JSON.stringify(valid));

    expect(result.ok && result.document).toEqual(valid);
  });
});

describe('import dialog', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
    document.body.innerHTML = '';
  });

  async function openDialog(api: typeof import('../api/client').api): Promise<void> {
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
    vi.mocked(api.libraryAdmin.getTopic).mockResolvedValue(detail);
    const { renderContentTab } = await import('./libraryAdminView');

    renderContentTab(mount());
    await settled();
    await settled();
    (document.querySelector('.la-edit') as HTMLButtonElement).click();
    await settled();
    await settled();
    (document.querySelector('.la-import') as HTMLButtonElement).click();
    await settled();
  }

  it('imports a pasted document with the chosen mode and reloads', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.importTopic).mockResolvedValue({ sections: 1, questions: 1 });
    const { SAMPLE_DOCUMENT: sample } = await import('./libraryAdminView');
    await openDialog(api);

    const textarea = document.querySelector('.la-import-text') as HTMLTextAreaElement;
    textarea.value = JSON.stringify(sample);
    textarea.dispatchEvent(new Event('input'));
    await settled();
    expect(document.querySelector('.la-import-preview')?.textContent).toContain('1');
    expect((document.querySelector('.la-import-submit') as HTMLButtonElement).disabled).toBe(false);

    (document.querySelector('.la-import-mode') as HTMLSelectElement).value = 'append';
    (document.querySelector('.la-import-submit') as HTMLButtonElement).click();
    await settled();
    await settled();

    expect(api.libraryAdmin.importTopic).toHaveBeenCalledWith('t-1', 'append', sample);
  });

  it('keeps the import button disabled while the document is invalid', async () => {
    const { api } = await import('../api/client');
    await openDialog(api);

    const textarea = document.querySelector('.la-import-text') as HTMLTextAreaElement;
    textarea.value = '{ broken';
    textarea.dispatchEvent(new Event('input'));
    await settled();

    expect(document.querySelector('.la-import-error')?.textContent).toBeTruthy();
    expect((document.querySelector('.la-import-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(api.libraryAdmin.importTopic).not.toHaveBeenCalled();
  });

  it('shows the server path when the server rejects the document', async () => {
    const { api, ApiError } = await import('../api/client');
    const failure = new ApiError(
      'Invalid input',
      400,
      'library_invalid_document',
      'sections[0].name',
    );
    vi.mocked(api.libraryAdmin.importTopic).mockRejectedValue(failure);
    const { SAMPLE_DOCUMENT: sample } = await import('./libraryAdminView');
    await openDialog(api);

    const textarea = document.querySelector('.la-import-text') as HTMLTextAreaElement;
    textarea.value = JSON.stringify(sample);
    textarea.dispatchEvent(new Event('input'));
    await settled();
    (document.querySelector('.la-import-submit') as HTMLButtonElement).click();
    await settled();
    await settled();

    const error = document.querySelector('.la-import-error')?.textContent ?? '';
    expect(error).toContain('Invalid input');
    expect(error).toContain('sections[0].name');
    expect(document.querySelector('.la-import-text')).not.toBeNull();
  });
});
