import { createFeedFetcher } from './fetcher';
import { parseFeedXml, type FeedArticle } from './parser';

export interface FeedSource {
  name: string;
  url: string;
}

export interface FeedServiceDeps {
  sources: FeedSource[];
  fetchXml?: (url: string) => Promise<string>;
  parseXml?: (source: string, xml: string) => Promise<FeedArticle[]>;
  ttlMs?: number;
  now?: () => number;
}

export interface FeedService {
  getFeed(): Promise<FeedArticle[]>;
}

export const DEFAULT_FEED_TTL_MS = 15 * 60 * 1000;

export function createFeedService(deps: FeedServiceDeps): FeedService {
  const fetchXml = deps.fetchXml ?? createFeedFetcher().fetchXml;
  const parseXml = deps.parseXml ?? parseFeedXml;
  const ttlMs = deps.ttlMs ?? DEFAULT_FEED_TTL_MS;
  const now = deps.now ?? Date.now;

  let cache: FeedArticle[] = [];
  let cachedAt = Number.NEGATIVE_INFINITY;
  let inflight: Promise<FeedArticle[]> | null = null;

  async function refresh(): Promise<FeedArticle[]> {
    const batches = await Promise.all(
      deps.sources.map(async (source) => {
        try {
          const xml = await fetchXml(source.url);
          return await parseXml(source.name, xml);
        } catch {
          // A broken source must never break the whole feed.
          return [] as FeedArticle[];
        }
      }),
    );

    const seen = new Set<string>();
    const merged = batches.flat().filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
    merged.sort(
      (left, right) =>
        right.publishedAt.localeCompare(left.publishedAt) || left.title.localeCompare(right.title),
    );

    cache = merged;
    cachedAt = now();
    return cache;
  }

  return {
    async getFeed(): Promise<FeedArticle[]> {
      if (now() - cachedAt < ttlMs) return cache;
      inflight ??= refresh().finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
}
