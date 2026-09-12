import type { FeedSource } from './feedService';

/**
 * Curated default feed sources. Every URL is a public RSS/Atom feed
 * with programming content. Tweak or extend freely — the feed service
 * isolates failures per source.
 */
export const DEFAULT_FEED_SOURCES: FeedSource[] = [
  { name: 'VnExpress Số hóa', url: 'https://vnexpress.net/rss/so-hoa.rss' },
  { name: 'Viblo', url: 'https://viblo.asia/rss' },
  { name: 'TopDev Blog', url: 'https://topdev.vn/blog/feed/' },
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage' },
  { name: 'dev.to', url: 'https://dev.to/feed' },
];
