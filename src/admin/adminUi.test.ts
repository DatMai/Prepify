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

describe('admin ui helpers', () => {
  // jsdom has no blob URLs, so the two methods are bolted onto the real URL
  // constructor; replacing it outright breaks `new URL()` inside the runner.
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:snapshot');
  const revokeObjectURL = vi.fn((_url: string) => undefined);

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    document.body.innerHTML = '';
  });

  it('hands a snapshot to the browser as a named JSON file', async () => {
    const { downloadJson } = await import('./adminUi');
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });

    downloadJson('dsa.json', { a: 1 });

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe('{\n  "a": 1\n}');
    expect(click).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual(['dsa.json']);
    // the anchor is only a vehicle for the click, never left behind in the page
    expect(document.querySelector('a')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:snapshot');
  });

  it('routes saveSnapshot through the registered downloader', async () => {
    const { saveSnapshot, setSnapshotDownloader } = await import('./adminUi');
    const sink = vi.fn();
    setSnapshotDownloader(sink);

    saveSnapshot('x.json', { a: 1 });

    expect(sink).toHaveBeenCalledWith('x.json', { a: 1 });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('reports a failed action as a toast instead of a rejection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { runAction } = await import('./adminUi');
    const boom = new Error('boom');

    await expect(
      runAction(async () => {
        throw boom;
      }),
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(boom);
    expect(document.querySelector('.toast')?.textContent).toBeTruthy();
  });
});
