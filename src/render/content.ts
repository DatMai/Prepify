import { DATA } from '../data/loader';
import { keyOf, toggleProgress, state } from '../state/progress';
import { blockHTML } from './block';
import { esc, hl } from './escape';
import { runCode } from './runCode';
import { renderTopics, updateGlobalProgress } from './sidebar';

function onTopicChange(key: string): void {
  state.topic = key;
  render();
  document.getElementById('sidebar')?.classList.remove('show');
  const content = document.getElementById('content');
  if (content) content.scrollTop = 0;
}

export function render(): void {
  const t = DATA[state.topic];
  if (!t) return;

  const titleEl = document.getElementById('tTitle');
  const subEl = document.getElementById('tSub');
  if (titleEl) titleEl.textContent = t.label;
  const total = t.sections.reduce((a, s) => a + s.questions.length, 0);
  if (subEl) subEl.textContent = `// ${t.subtitle || ''}  ·  ${total} câu`;

  renderTopics(onTopicChange);
  updateGlobalProgress();

  const inner = document.getElementById('inner');
  const searchEl = document.getElementById('search') as HTMLInputElement | null;
  const search = (searchEl?.value || '').trim().toLowerCase();
  if (!inner) return;
  inner.innerHTML = '';

  let shown = 0;
  t.sections.forEach((sec, si) => {
    const matched = sec.questions
      .map((q, qi) => ({ q, qi }))
      .filter(({ q }) => {
        if (!search) return true;
        const hay =
          (
            q.q +
            ' ' +
            q.blocks
              .map((b) => {
                if (b.type === 'table') return b.rows.flat().join(' ');
                return 'text' in b ? b.text : '';
              })
              .join(' ')
          ).toLowerCase();
        return hay.includes(search);
      });
    if (!matched.length) return;

    const sh = document.createElement('div');
    sh.className = 'sec-head';
    sh.innerHTML = `<span class="dot" style="color:${t.color}"></span>${esc(sec.name)}`;
    inner.appendChild(sh);

    matched.forEach(({ q, qi }) => {
      shown++;
      const k = keyOf(state.topic, si, qi);
      const done = !!state.progress[k];
      const openKey = `${state.topic}_${si}_${qi}`;
      const isOpen = !!state.open[openKey];

      const card = document.createElement('div');
      card.className = 'card' + (done ? ' done' : '') + (isOpen ? ' open' : '');
      const qid = `${state.topic}${si}${qi}`;
      const blocks = q.blocks.map((b, bi) => blockHTML(b, qid, bi)).join('');
      card.innerHTML = `
        <div class="q-head">
          <span class="q-id">${shown}</span>
          <span class="q-text">${hl(q.q, search)}</span>
          <span class="q-check" title="Đánh dấu đã học">✓</span>
        </div>
        <button class="quiz-reveal-btn">Hiện đáp án</button>
        <div class="q-body">${blocks}</div>`;

      const head = card.querySelector<HTMLElement>('.q-head');
      head?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('q-check')) {
          const newVal = !state.progress[k];
          void toggleProgress(k, newVal);
          card.classList.toggle('done');
          renderTopics(onTopicChange);
          updateGlobalProgress();
          return;
        }
        state.open[openKey] = !state.open[openKey];
        card.classList.toggle('open');
      });

      card.querySelector('.quiz-reveal-btn')?.addEventListener('click', () => {
        card.classList.add('reveal');
      });

      card.querySelectorAll<HTMLButtonElement>('.run-btn[data-cid]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const cid = btn.getAttribute('data-cid');
          if (cid) runCode(cid);
        });
      });

      inner.appendChild(card);
    });
  });

  if (!shown) {
    inner.innerHTML = '<div class="empty">Không tìm thấy câu hỏi nào khớp.</div>';
  }
}
