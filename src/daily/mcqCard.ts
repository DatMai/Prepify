import type { McqDailyQuestion } from './types';

export interface McqResult {
  selectedIdx: number;
}

export function renderMcqCard(
  q: McqDailyQuestion,
  onAnswer: (result: McqResult) => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'daily-card daily-mcq';

  card.innerHTML = `
    <div class="daily-q">${escHtml(q.q)}</div>
    <div class="daily-options">
      ${q.options
        .map(
          (opt) => `
        <button class="daily-opt" data-idx="${opt.idx}">
          <span class="daily-opt-letter">${String.fromCharCode(65 + opt.idx)}</span>
          <span class="daily-opt-text">${escHtml(opt.text)}</span>
        </button>
      `,
        )
        .join('')}
    </div>
  `;

  card.querySelectorAll<HTMLButtonElement>('.daily-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (card.dataset.answered) return;
      card.dataset.answered = '1';

      const idx = parseInt(btn.dataset.idx ?? '0', 10);

      card.querySelectorAll<HTMLButtonElement>('.daily-opt').forEach((b) => {
        b.disabled = true;
        if (parseInt(b.dataset.idx ?? '0', 10) === idx) b.classList.add('selected');
      });

      onAnswer({ selectedIdx: idx });
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
