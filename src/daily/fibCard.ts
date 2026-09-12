import type { FibDailyQuestion } from './types';
import { t } from '../i18n';

export interface FibResult {
  blanks: string[];
}

export function renderFibCard(
  q: FibDailyQuestion,
  onAnswer: (result: FibResult) => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'daily-card daily-fib';

  const parts = q.prompt.split('___');
  const inputIds = Array.from({ length: q.blankCount }, (_, i) => `fib-blank-${q.id}-${i}`);

  let promptHtml = '';
  parts.forEach((part, i) => {
    promptHtml += escHtml(part);
    if (i < q.blankCount) {
      promptHtml += `<input
        class="fib-input"
        id="${inputIds[i]}"
        autocomplete="off"
        spellcheck="false"
        placeholder="..."
      />`;
    }
  });

  card.innerHTML = `
    <div class="daily-fib-prompt">${promptHtml}</div>
    ${
      q.hint
        ? `
      <button class="fib-hint-btn" id="fib-hint-${q.id}">${t('fib.hint')}</button>
      <div class="fib-hint" id="fib-hint-text-${q.id}" hidden>${escHtml(q.hint)}</div>
    `
        : ''
    }
    <div class="daily-fib-actions">
      <button class="daily-submit-btn" id="fib-submit-${q.id}">${t('fib.check')}</button>
    </div>
    <div class="fib-feedback" id="fib-feedback-${q.id}" hidden></div>
  `;

  // Hint toggle
  card.querySelector(`#fib-hint-${q.id}`)?.addEventListener('click', () => {
    const hint = card.querySelector<HTMLElement>(`#fib-hint-text-${q.id}`);
    if (hint) hint.hidden = !hint.hidden;
  });

  // Submit
  card.querySelector(`#fib-submit-${q.id}`)?.addEventListener('click', () => {
    if (card.dataset.answered) return;
    card.dataset.answered = '1';

    const blanks = inputIds.map((_, i) => {
      const input = card.querySelector<HTMLInputElement>(`#${inputIds[i]}`);
      return input?.value ?? '';
    });

    blanks.forEach((_, i) => {
      const input = card.querySelector<HTMLInputElement>(`#${inputIds[i]}`);
      if (input) input.disabled = true;
    });

    const submitBtn = card.querySelector<HTMLButtonElement>(`#fib-submit-${q.id}`);
    if (submitBtn) submitBtn.disabled = true;

    onAnswer({ blanks });
  });

  // Enter key on last input submits
  card.querySelectorAll<HTMLInputElement>('.fib-input').forEach((input, i, all) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (i === all.length - 1) {
          (card.querySelector(`#fib-submit-${q.id}`) as HTMLButtonElement)?.click();
        } else {
          (all[i + 1] as HTMLInputElement).focus();
        }
      }
    });
  });

  return card;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
