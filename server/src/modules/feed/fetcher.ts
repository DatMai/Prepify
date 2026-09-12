const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<FetchLikeResponse>;

export interface FeedFetcherDeps {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface FeedFetcher {
  fetchXml(url: string): Promise<string>;
}

export function createFeedFetcher(deps: FeedFetcherDeps = {}): FeedFetcher {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;

  return {
    async fetchXml(url: string): Promise<string> {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(
          `feed_fetcher: unsupported protocol '${parsed.protocol}' (http/https only)`,
        );
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          headers: {
            Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
            'User-Agent': 'PrepifyBot/0.1 (+https://github.com/DatMai/Prepify)',
          },
          redirect: 'follow',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`feed_fetcher: HTTP ${response.status}`);
        }
        const text = await response.text();
        if (text.length > maxBytes) {
          throw new Error(`feed_fetcher: response too large (exceeds ${maxBytes} bytes)`);
        }
        return text;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
