import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createFeedRouter } from './feed';
import type { FeedArticle } from '../modules/feed/parser';

const items: FeedArticle[] = [
  {
    title: 'a',
    url: 'https://x/a',
    summary: '',
    source: 'S',
    publishedAt: '2026-09-12T10:00:00.000Z',
  },
  {
    title: 'b',
    url: 'https://x/b',
    summary: '',
    source: 'S',
    publishedAt: '2026-09-11T10:00:00.000Z',
  },
  {
    title: 'c',
    url: 'https://x/c',
    summary: '',
    source: 'S',
    publishedAt: '2026-09-10T10:00:00.000Z',
  },
];

function app(service: { getFeed(): Promise<FeedArticle[]> }) {
  const instance = express();
  instance.use(express.json());
  instance.use('/feed', createFeedRouter({ service }));
  return instance;
}

describe('feed routes', () => {
  it('serves the feed publicly without authentication', async () => {
    const service = { getFeed: vi.fn().mockResolvedValue(items) };
    const response = await request(app(service)).get('/feed').expect(200);

    expect(response.body.items).toEqual(items);
  });

  it('applies the requested limit and defaults to 30', async () => {
    const service = { getFeed: vi.fn().mockResolvedValue(items) };

    const limited = await request(app(service)).get('/feed?limit=2').expect(200);
    expect(limited.body.items).toHaveLength(2);

    const defaulted = await request(app(service)).get('/feed').expect(200);
    expect(defaulted.body.items).toHaveLength(3);
  });

  it('ignores invalid limits', async () => {
    const service = { getFeed: vi.fn().mockResolvedValue(items) };

    await request(app(service)).get('/feed?limit=abc').expect(200);
    await request(app(service)).get('/feed?limit=0').expect(200);
    await request(app(service)).get('/feed?limit=999').expect(200);
  });
});
