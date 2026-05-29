import type { Block } from '../types/quiz';
import { esc } from './escape';

export function blockHTML(b: Block, qid: string, bIdx: number): string {
  if (b.type === 'text') {
    return `<div class="blk text">${esc(b.text)}</div>`;
  }
  if (b.type === 'note') {
    return `<div class="blk"><div class="note">${esc(b.text)}</div></div>`;
  }
  if (b.type === 'table') {
    let h = '<div class="blk"><table class="qt">';
    b.rows.forEach((r, i) => {
      const tag = i === 0 ? 'th' : 'td';
      h += '<tr>' + r.map((c) => `<${tag}>${esc(c)}</${tag}>`).join('') + '</tr>';
    });
    return h + '</table></div>';
  }
  if (b.type === 'code') {
    const runnable = b.lang === 'js' || b.lang === 'ts';
    const cid = qid + '_' + bIdx;
    const runBtn = runnable
      ? `<button class="run-btn" data-cid="${cid}">▶ Run</button>`
      : `<span>${esc(b.lang)}</span>`;
    return `<div class="blk"><pre class="code"><span class="clabel"><span>${esc(b.lang)}</span>${runBtn}</span><code id="code_${cid}">${esc(b.text)}</code></pre><div class="run-out" id="out_${cid}"></div></div>`;
  }
  return '';
}
