import { describe, expect, it, vi } from 'vitest';
import { createFeedService, type FeedSource } from './feedService';
import type { FeedArticle } from './parser';

function article(overrides: Partial<FeedArticle> & { title: string; url: string }): FeedArticle {
  return {
    source: 'S',
    summary: '',
    publishedAt: '2026-09-12T10:00:00.000Z',
    ...overrides,
  };
}

const sources: FeedSource[] = [
  { name: 'Alpha', url: 'https://alpha.dev/feed' },
  { name: 'Beta', url: 'https://beta.dev/feed' },
];

describe('createFeedService', () => {
  it('merges and sorts articles from all sources, newest first', async () => {
    const fetchXml = vi.fn(async (url: string) => (url.includes('alpha') ? 'a' : 'b'));
    const parseXml = vi.fn(async (source: string) =>
      source === 'Alpha'
        ? [article({ title: 'old', url: 'https://x/old', publishedAt: '2026-09-10T10:00:00.000Z' })]
        : [
            article({
              title: 'new',
              url: 'https://x/new',
              publishedAt: '2026-09-11T10:00:00.000Z',
            }),
          ],
    );
    const service = createFeedService({ sources, fetchXml, parseXml });

    const items = await service.getFeed();

    expect(items.map((item) => item.title)).toEqual(['new', 'old']);
  });

  it('dedupes the same article URL across sources', async () => {
    const fetchXml = vi.fn(async () => 'xml');
    const parseXml = vi.fn(async (source: string) =>
      source === 'Alpha'
        ? [article({ title: 'dup', url: 'https://x/dup' })]
        : [
            article({ title: 'dup', url: 'https://x/dup' }),
            article({ title: 'uniq', url: 'https://x/u' }),
          ],
    );
    const service = createFeedService({ sources, fetchXml, parseXml });

    const items = await service.getFeed();

    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.url)).size).toBe(2);
  });

  it('keeps working when one source fails', async () => {
    const fetchXml = vi.fn(async (url: string) => {
      if (url.includes('beta')) throw new Error('beta down');
      return 'xml';
    });
    const parseXml = vi.fn(async () => [article({ title: 'alpha-only', url: 'https://x/a' })]);
    const service = createFeedService({ sources, fetchXml, parseXml });

    const items = await service.getFeed();

    expect(items.map((item) => item.title)).toEqual(['alpha-only']);
  });

  it('serves from cache within the TTL window', async () => {
    const fetchXml = vi.fn(async () => 'xml');
    const parseXml = vi.fn(async () => [article({ title: 'cached', url: 'https://x/c' })]);
    const service = createFeedService({ sources, fetchXml, parseXml, ttlMs: 60_000 });

    await service.getFeed();
    await service.getFeed();

    expect(fetchXml).toHaveBeenCalledTimes(sources.length);
  });

  it('refetches after the TTL expires', async () => {
    let fakeNow = 0;
    const fetchXml = vi.fn(async () => 'xml');
    const parseXml = vi.fn(async () => [article({ title: 't', url: 'https://x/t' })]);
    const service = createFeedService({
      sources,
      fetchXml,
      parseXml,
      ttlMs: 100,
      now: () => fakeNow,
    });

    await service.getFeed();
    fakeNow = 200;
    await service.getFeed();

    expect(fetchXml).toHaveBeenCalledTimes(sources.length * 2);
  });

  it('shares one refresh across concurrent callers', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchXml = vi.fn(async () => {
      await gate;
      return 'xml';
    });
    const parseXml = vi.fn(async () => [article({ title: 'once', url: 'https://x/o' })]);
    const service = createFeedService({ sources, fetchXml, parseXml });

    const firstPromise = service.getFeed();
    const secondPromise = service.getFeed();
    release();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.map((item) => item.title)).toEqual(['once']);
    expect(second).toBe(first);
    expect(fetchXml).toHaveBeenCalledTimes(sources.length);
  });
});
