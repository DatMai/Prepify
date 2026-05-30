import type { FibDailyQuestion } from './types';
import { gradeFib } from './grader';

export interface FibResult {
  correct: boolean;
  allCorrect: boolean;
  perBlank: boolean[];
}

export function renderFibCard(
  q: FibDailyQuestion,
  onAnswer: (result: FibResult) => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'daily-card daily-fib';

  const parts = q.prompt.split('___');
  const inputIds = q.blanks.map((_, i) => `fib-blank-${q.id}-${i}`);

  let promptHtml = '';
  parts.forEach((part, i) => {
    promptHtml += escHtml(part);
    if (i < q.blanks.length) {
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
    ${q.hint ? `
      <button class="fib-hint-btn" id="fib-hint-${q.id}">💡 Gợi ý</button>
      <div class="fib-hint" id="fib-hint-text-${q.id}" hidden>${escHtml(q.hint)}</div>
    ` : ''}
    <div class="daily-fib-actions">
      <button class="daily-submit-btn" id="fib-submit-${q.id}">Kiểm tra</button>
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

    const perBlank = q.blanks.map((blank, i) => {
      const input = card.querySelector<HTMLInputElement>(`#${inputIds[i]}`);
      return input ? gradeFib(input.value, blank) : false;
    });
    const allCorrect = perBlank.every(Boolean);

    // Highlight inputs
    perBlank.forEach((ok, i) => {
      const input = card.querySelector<HTMLInputElement>(`#${inputIds[i]}`);
      if (input) {
        input.disabled = true;
        input.classList.add(ok ? 'fib-correct' : 'fib-wrong');
      }
    });

    // Feedback
    const feedback = card.querySelector<HTMLElement>(`#fib-feedback-${q.id}`);
    if (feedback) {
      feedback.hidden = false;
      if (allCorrect) {
        feedback.className = 'fib-feedback fib-feedback-ok';
        feedback.textContent = '✓ Chính xác!';
      } else {
        feedback.className = 'fib-feedback fib-feedback-err';
        const answers = q.blanks.join(', ');
        feedback.textContent = `✗ Đáp án: ${answers}`;
      }
    }

    const submitBtn = card.querySelector<HTMLButtonElement>(`#fib-submit-${q.id}`);
    if (submitBtn) submitBtn.disabled = true;

    onAnswer({ correct: allCorrect, allCorrect, perBlank });
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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
