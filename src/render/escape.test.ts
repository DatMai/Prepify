import { describe, expect, it } from 'vitest';
import { esc, hl } from './escape';

describe('HTML-safe rendering helpers', () => {
  it('escapes markup and ampersands', () => {
    expect(esc('<script>a&b</script>')).toBe('&lt;script&gt;a&amp;b&lt;/script&gt;');
  });

  it('highlights a literal query without interpreting regular expressions', () => {
    expect(hl('Array.from(value)', 'Array.')).toBe('<span class="hl">Array.</span>from(value)');
  });
});
