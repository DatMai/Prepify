import { describe, expect, it, vi } from 'vitest';
import { createFeedFetcher } from './fetcher';

function response(
  overrides: {
    ok?: boolean;
    status?: number;
    text?: string;
    contentType?: string;
  } = {},
): {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
} {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    text: () => Promise.resolve(overrides.text ?? '<rss/>'),
  };
}

describe('createFeedFetcher', () => {
  it('rejects non-http(s) URLs without fetching', async () => {
    const fetchImpl = vi.fn();
    const fetcher = createFeedFetcher({ fetchImpl });

    await expect(fetcher.fetchXml('ftp://example.dev/feed')).rejects.toThrow(/http/);
    await expect(fetcher.fetchXml('file:///etc/passwd')).rejects.toThrow(/http/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns the XML body for a successful response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ text: '<rss>ok</rss>' }));
    const fetcher = createFeedFetcher({ fetchImpl });

    await expect(fetcher.fetchXml('https://example.dev/feed')).resolves.toBe('<rss>ok</rss>');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.dev/feed',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        redirect: 'follow',
      }),
    );
  });

  it('rejects non-2xx responses', async () => {
    const fetcher = createFeedFetcher({
      fetchImpl: vi.fn().mockResolvedValue(response({ ok: false, status: 503 })),
    });

    await expect(fetcher.fetchXml('https://example.dev/feed')).rejects.toThrow(/503/);
  });

  it('rejects responses larger than the byte cap', async () => {
    const fetcher = createFeedFetcher({
      fetchImpl: vi.fn().mockResolvedValue(response({ text: 'x'.repeat(1_500_000) })),
      maxBytes: 1_000_000,
    });

    await expect(fetcher.fetchXml('https://example.dev/feed')).rejects.toThrow(/large/);
  });

  it('aborts when the request exceeds the timeout', async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'AbortError')),
          );
        }),
    );
    const fetcher = createFeedFetcher({ fetchImpl, timeoutMs: 20 });

    await expect(fetcher.fetchXml('https://example.dev/feed')).rejects.toThrow(/abort/i);
  });
});
