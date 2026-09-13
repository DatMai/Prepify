import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('favorite filter control', () => {
  it('uses the shared SVG icon system instead of a text heart glyph', () => {
    const html = readFileSync('index.html', 'utf8');
    const button = html.match(/<button[^>]*id="favFilterBtn"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';

    expect(button).not.toContain('♥');
    expect(button).toContain('data-icon="heart"');
  });

  it('matches the topbar control height', () => {
    const css = readFileSync('src/styles/favorites.css', 'utf8');

    expect(css).toMatch(/\.filter-fav-btn\s*\{[\s\S]*?height:\s*40px/);
  });
});
