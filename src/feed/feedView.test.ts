import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedArticle } from './types';

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

const alpha: FeedArticle = {
  title: 'Post A',
  url: 'https://alpha.dev/1',
  summary: 'Summary A',
  source: 'Alpha',
  publishedAt: '2026-09-12T09:00:00.000Z',
};

const beta: FeedArticle = {
  title: '<img src=x onerror=alert(1)>',
  url: 'https://beta.dev/2',
  summary: '<script>alert(2)</script>',
  source: 'Beta',
  publishedAt: '2026-09-12T08:00:00.000Z',
};

function mount(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('initFeed', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
    document.body.innerHTML = '';
    container = mount();
  });

  it('shows a skeleton while loading and cards afterwards', async () => {
    const { initFeed } = await import('./feedView');
    let resolve!: (items: FeedArticle[]) => void;
    const load = vi.fn(
      () =>
        new Promise<FeedArticle[]>((res) => {
          resolve = res;
        }),
    );
    initFeed({ container, load, t: (key) => key, formatTime: () => 'TIME' });

    expect(container.querySelector('.feed-skeleton')).not.toBeNull();

    resolve([alpha]);
    await settled();
    await settled();

    expect(container.querySelector('.feed-card')).not.toBeNull();
    expect(container.textContent).toContain('Post A');
  });

  it('escapes titles and summaries', async () => {
    const { initFeed } = await import('./feedView');
    initFeed({
      container,
      load: () => Promise.resolve([beta]),
      t: (key) => key,
      formatTime: () => 'TIME',
    });
    await settled();
    await settled();

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).toContain('&lt;img');
  });

  it('opens articles in a new tab', async () => {
    const { initFeed } = await import('./feedView');
    initFeed({
      container,
      load: () => Promise.resolve([alpha]),
      t: (key) => key,
      formatTime: () => 'TIME',
    });
    await settled();
    await settled();

    const link = container.querySelector<HTMLAnchorElement>('a.feed-link');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link!.getAttribute('href')).toBe('https://alpha.dev/1');
  });

  it('filters cards by source chip', async () => {
    const { initFeed } = await import('./feedView');
    initFeed({
      container,
      load: () => Promise.resolve([alpha, beta]),
      t: (key) => key,
      formatTime: () => 'TIME',
    });
    await settled();
    await settled();

    const chip = container.querySelector<HTMLButtonElement>('.feed-chip[data-source="Alpha"]');
    expect(chip).not.toBeNull();
    chip!.click();

    expect(container.querySelector('.feed-card[data-source="Alpha"]')?.hasAttribute('hidden')).toBe(
      false,
    );
    expect(container.querySelector('.feed-card[data-source="Beta"]')?.hasAttribute('hidden')).toBe(
      true,
    );
  });

  it('shows an empty state when there are no items', async () => {
    const { initFeed } = await import('./feedView');
    initFeed({
      container,
      load: () => Promise.resolve([]),
      t: (key) => key,
      formatTime: () => 'TIME',
    });
    await settled();
    await settled();

    expect(container.textContent).toContain('feed.empty');
    expect(container.querySelector('.feed-card')).toBeNull();
  });

  it('shows an error state and retries on demand', async () => {
    const { initFeed } = await import('./feedView');
    const load = vi
      .fn<() => Promise<FeedArticle[]>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([alpha]);
    initFeed({ container, load, t: (key) => key, formatTime: () => 'TIME' });
    await settled();
    await settled();

    expect(container.textContent).toContain('feed.error');

    container.querySelector<HTMLButtonElement>('.feed-retry')!.click();
    await settled();
    await settled();

    expect(load).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Post A');
  });

  it('repaints labels when the language changes', async () => {
    const { initFeed, repaintFeed } = await import('./feedView');
    let lang = 'vi';
    const translate = (key: string) => (lang === 'vi' ? `VI:${key}` : `EN:${key}`);
    initFeed({
      container,
      load: () => Promise.resolve([alpha]),
      t: translate,
      formatTime: () => 'TIME',
    });
    await settled();
    await settled();

    expect(container.textContent).toContain('VI:feed.title');

    lang = 'en';
    repaintFeed();

    expect(container.textContent).toContain('EN:feed.title');
  });

  it('renders a list layout with monogram, meta and reading time by default', async () => {
    const { initFeed } = await import('./feedView');
    initFeed({
      container,
      load: () => Promise.resolve([alpha]),
      t: (key) => key,
      formatTime: () => 'TIME',
    });
    await settled();
    await settled();

    expect(container.querySelector('.feed-list')).not.toBeNull();
    expect(container.querySelector('.feed-grid')).toBeNull();
    expect(container.querySelector('.feed-tile')?.textContent).toBe('A');
    expect(container.querySelector('.feed-reading')?.textContent).toContain('feed.readTime');
    expect(container.querySelector('.feed-count')?.textContent).toContain('feed.count');
  });

  it('switches between list and grid views', async () => {
    const { initFeed } = await import('./feedView');
    initFeed({
      container,
      load: () => Promise.resolve([alpha]),
      t: (key) => key,
      formatTime: () => 'TIME',
    });
    await settled();
    await settled();

    container.querySelector<HTMLButtonElement>('.feed-view-btn[data-view="grid"]')!.click();
    expect(container.querySelector('.feed-grid')).not.toBeNull();
    expect(container.querySelector('.feed-list')).toBeNull();

    container.querySelector<HTMLButtonElement>('.feed-view-btn[data-view="list"]')!.click();
    expect(container.querySelector('.feed-list')).not.toBeNull();
    expect(container.querySelector('.feed-grid')).toBeNull();
  });
});

describe('timeAgoLabel', () => {
  const now = Date.parse('2026-09-12T10:00:00.000Z');

  it('formats minutes, hours, days and just-now', async () => {
    const { timeAgoLabel } = await import('./feedView');

    expect(timeAgoLabel('2026-09-12T09:55:00.000Z', now)).toEqual({ key: 'feed.minutes', n: 5 });
    expect(timeAgoLabel('2026-09-12T07:00:00.000Z', now)).toEqual({ key: 'feed.hours', n: 3 });
    expect(timeAgoLabel('2026-09-10T10:00:00.000Z', now)).toEqual({ key: 'feed.days', n: 2 });
    expect(timeAgoLabel('2026-09-12T09:59:59.000Z', now)).toEqual({ key: 'feed.justNow', n: 0 });
  });
});
