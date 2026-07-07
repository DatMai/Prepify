import type { Question } from '../types/quiz';
import { esc } from '../render/escape';
import { blockHTML } from '../render/block';
import { t } from '../i18n';

export function renderFlashcard(q: Question, qid: string, isFlipped: boolean): string {
  return `
    <div class="flip-card${isFlipped ? ' flipped' : ''}">
      <div class="flip-inner">
        <div class="flip-front">
          <div class="fc-question">${esc(q.q)}</div>
          <div class="fc-hint">${t('fc.flipHint')}</div>
        </div>
        <div class="flip-back">
          <div class="fc-answer">
            ${q.blocks.map((b, bi) => blockHTML(b, qid, bi)).join('')}
          </div>
          <div class="grade-btns">
            <button class="grade-btn grade-1" data-grade="1">${t('fc.forgot')}</button>
            <button class="grade-btn grade-2" data-grade="2">${t('fc.unsure')}</button>
            <button class="grade-btn grade-3" data-grade="3">${t('fc.gotIt')}</button>
          </div>
        </div>
      </div>
    </div>`;
}
