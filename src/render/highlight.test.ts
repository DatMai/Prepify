import { describe, expect, it } from 'vitest';
import { highlightCode } from './highlight';

describe('highlightCode', () => {
  it('escapes markup before adding syntax spans', () => {
    const html = highlightCode('<img src=x onerror=alert(1)>', 'js');

    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=alert(1)>');
  });

  it('keeps unsupported languages as escaped plain text', () => {
    expect(highlightCode('<b>plain</b>', 'sql')).toBe('&lt;b&gt;plain&lt;/b&gt;');
  });

  it('marks JavaScript tokens without changing their text', () => {
    const source = 'const answer = 42; // result';
    const container = document.createElement('code');
    container.innerHTML = highlightCode(source, 'js');

    expect(container.textContent).toBe(source);
    expect(container.querySelector('.tok-kw')?.textContent).toBe('const');
    expect(container.querySelector('.tok-num')?.textContent).toBe('42');
    expect(container.querySelector('.tok-com')?.textContent).toBe('// result');
  });
});
