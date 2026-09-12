import { describe, expect, it } from 'vitest';
import { parseFeedXml, type FeedArticle } from './parser';

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Dev Blog</title>
    <item>
      <title>First &amp; Great Post</title>
      <link>https://example.dev/1</link>
      <description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;</description>
      <pubDate>Mon, 12 Sep 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Older Post</title>
      <link>https://example.dev/2</link>
      <description>Plain text summary</description>
      <pubDate>Sun, 11 Sep 2026 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Blog</title>
  <entry>
    <title>Atom entry</title>
    <link href="https://example.atom/9"/>
    <summary type="html">&lt;div&gt;Summary with &lt;em&gt;markup&lt;/em&gt;&lt;/div&gt;</summary>
    <updated>2026-09-10T08:30:00Z</updated>
  </entry>
</feed>`;

function parse(xml: string): Promise<FeedArticle[]> {
  return parseFeedXml('Test Source', xml);
}

describe('parseFeedXml', () => {
  it('normalizes RSS 2.0 items with plain-text summaries', async () => {
    const items = await parse(rss);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: 'First & Great Post',
      url: 'https://example.dev/1',
      summary: 'Hello world',
      source: 'Test Source',
      publishedAt: '2026-09-12T10:00:00.000Z',
    });
    expect(items[1]).toMatchObject({ title: 'Older Post', summary: 'Plain text summary' });
  });

  it('normalizes Atom entries', async () => {
    const items = await parse(atom);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Atom entry',
      url: 'https://example.atom/9',
      summary: 'Summary with markup',
      source: 'Test Source',
      publishedAt: '2026-09-10T08:30:00.000Z',
    });
  });

  it('skips items without a title or link', async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>T</title>
        <item><description>no title</description></item>
        <item><title>no link</title></item>
        <item><title>complete</title><link>https://example.dev/ok</link></item>
      </channel></rss>`;

    const items = await parse(xml);

    expect(items.map((item) => item.url)).toEqual(['https://example.dev/ok']);
  });

  it('sorts newest first and sinks undated items to the bottom', async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>T</title>
        <item><title>old</title><link>https://example.dev/old</link><pubDate>Tue, 10 Sep 2026 10:00:00 GMT</pubDate></item>
        <item><title>undated</title><link>https://example.dev/undated</link></item>
        <item><title>new</title><link>https://example.dev/new</link><pubDate>Wed, 11 Sep 2026 10:00:00 GMT</pubDate></item>
      </channel></rss>`;

    const items = await parse(xml);

    expect(items.map((item) => item.title)).toEqual(['new', 'old', 'undated']);
    expect(items[2].publishedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('truncates long summaries to 280 characters', async () => {
    const long = 'word '.repeat(100).trim();
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>T</title>
        <item><title>long</title><link>https://example.dev/long</link><description>${long}</description></item>
      </channel></rss>`;

    const [item] = await parse(xml);

    expect(item.summary).toHaveLength(280);
    expect(item.summary.endsWith('…')).toBe(true);
  });

  it('strips markdown artifacts from summaries', async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>T</title>
        <item><title>Tidy</title><link>https://example.dev/tidy</link><description>![cover](https://x/img.png) Some *bold* and _em_ and [link](https://x) text</description></item>
      </channel></rss>`;

    const [item] = await parse(xml);

    expect(item.summary).toBe('Some bold and em and link text');
  });

  it('drops a leading title repeated inside the summary', async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>T</title>
        <item><title>Great Post</title><link>https://example.dev/great</link><description>Great Post By Nokka | September 11, 2026 The real content follows.</description></item>
      </channel></rss>`;

    const [item] = await parse(xml);

    expect(item.summary).not.toContain('Great Post');
    expect(item.summary).toContain('The real content follows');
  });
});
