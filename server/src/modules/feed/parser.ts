import Parser from 'rss-parser';

export interface FeedArticle {
  title: string;
  url: string;
  summary: string;
  source: string;
  publishedAt: string;
}

const MAX_SUMMARY_LENGTH = 280;
const DEFAULT_PUBLISHED_AT = '1970-01-01T00:00:00.000Z';

interface RawItem {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  published?: string;
  updated?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  'content:encoded'?: string;
  'content:encodedSnippet'?: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSummary(item: RawItem): string {
  const raw =
    item.contentSnippet ??
    item['content:encodedSnippet'] ??
    (item.content ? stripHtml(item.content) : undefined) ??
    (item.summary ? stripHtml(item.summary) : undefined);
  const text = raw ?? '';
  if (text.length <= MAX_SUMMARY_LENGTH) return text;
  return `${text.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…`;
}

function cleanPublishedAt(item: RawItem): string {
  const candidate = item.isoDate ?? item.pubDate ?? item.published ?? item.updated;
  const timestamp = candidate ? Date.parse(candidate) : NaN;
  return Number.isNaN(timestamp) ? DEFAULT_PUBLISHED_AT : new Date(timestamp).toISOString();
}

export async function parseFeedXml(source: string, xml: string): Promise<FeedArticle[]> {
  const parsed = await new Parser<Record<string, unknown>, RawItem>().parseString(xml);
  const items = (parsed.items ?? [])
    .filter(
      (item): item is RawItem => typeof item.title === 'string' && typeof item.link === 'string',
    )
    .map((item) => ({
      title: item.title!.trim(),
      url: item.link!.trim(),
      summary: cleanSummary(item),
      source,
      publishedAt: cleanPublishedAt(item),
    }));

  items.sort(
    (left, right) =>
      right.publishedAt.localeCompare(left.publishedAt) || left.title.localeCompare(right.title),
  );
  return items;
}
