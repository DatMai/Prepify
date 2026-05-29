import type { Question } from '../types/quiz';
import { esc } from '../render/escape';
import { blockHTML } from '../render/block';

export function renderFlashcard(q: Question, qid: string, isFlipped: boolean): string {
  return `
    <div class="flip-card${isFlipped ? ' flipped' : ''}">
      <div class="flip-inner">
        <div class="flip-front">
          <div class="fc-question">${esc(q.q)}</div>
          <div class="fc-hint">Nhấn Space hoặc click để lật thẻ</div>
        </div>
        <div class="flip-back">
          <div class="fc-answer">
            ${q.blocks.map((b, bi) => blockHTML(b, qid, bi)).join('')}
          </div>
          <div class="grade-btns">
            <button class="grade-btn grade-1" data-grade="1">😰 Chưa nhớ</button>
            <button class="grade-btn grade-2" data-grade="2">🤔 Còn phân vân</button>
            <button class="grade-btn grade-3" data-grade="3">✅ Nhớ rồi</button>
          </div>
        </div>
      </div>
    </div>`;
}
