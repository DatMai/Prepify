import { DATA, ORDER } from '../data/loader';
import { keyOf, state } from '../state/progress';

export function renderTopics(onTopicChange: (key: string) => void): void {
  const el = document.getElementById('topics');
  if (!el) return;
  el.innerHTML = '';

  ORDER.forEach((k) => {
    const t = DATA[k];
    if (!t) return;
    const total = t.sections.reduce((a, s) => a + s.questions.length, 0);
    const done = Object.keys(state.progress).filter(
      (x) => x.startsWith(k + ':') && state.progress[x],
    ).length;

    const div = document.createElement('div');
    div.className = 'topic' + (k === state.topic ? ' active' : '');
    div.innerHTML = `<span class="dot" style="color:${t.color};background:${t.color}"></span>
      <span class="nm">${t.label}</span><span class="ct">${done}/${total}</span>`;
    div.addEventListener('click', () => onTopicChange(k));
    el.appendChild(div);
  });
}

export function updateGlobalProgress(): void {
  let total = 0;
  let done = 0;
  ORDER.forEach((k) => {
    const t = DATA[k];
    if (!t) return;
    t.sections.forEach((s, si) =>
      s.questions.forEach((_q, qi) => {
        total++;
        if (state.progress[keyOf(k, si, qi)]) done++;
      }),
    );
  });

  const pct = total ? Math.round((done / total) * 100) : 0;
  const fill = document.getElementById('pgFill');
  const text = document.getElementById('pgText');
  const pctEl = document.getElementById('pgPct');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = `${done} / ${total}`;
  if (pctEl) pctEl.textContent = pct + '%';
}
