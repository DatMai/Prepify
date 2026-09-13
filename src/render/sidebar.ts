import { DATA, ORDER, TOPIC_INDEX } from '../data/loader';
import { keyOf, state } from '../state/progress';

let _onTopicChange: ((key: string) => void) | null = null;

export function renderTopics(onTopicChange?: (key: string) => void): void {
  if (onTopicChange) _onTopicChange = onTopicChange;
  const el = document.getElementById('topics');
  if (!el) return;
  el.innerHTML = '';

  ORDER.forEach((k) => {
    const indexEntry = TOPIC_INDEX.find((entry) => entry.key === k);
    if (!indexEntry) return;
    const total = indexEntry.questionCount;
    const done = Object.keys(state.progress).filter(
      (x) => x.startsWith(k + ':') && state.progress[x],
    ).length;

    const div = document.createElement('div');
    div.className = 'topic' + (k === state.topic ? ' active' : '');
    div.innerHTML = `<span class="dot" style="color:${indexEntry.color};background:${indexEntry.color}"></span>
      <span class="nm">${indexEntry.label}</span><span class="ct">${done}/${total}</span>`;
    div.addEventListener('click', () => _onTopicChange?.(k));
    el.appendChild(div);
  });
}

export function updateGlobalProgress(): void {
  let total = 0;
  let done = 0;
  ORDER.forEach((k) => {
    const t = DATA[k];
    if (t) {
      t.sections.forEach((s, si) =>
        s.questions.forEach((_q, qi) => {
          total++;
          if (state.progress[keyOf(k, si, qi)]) done++;
        }),
      );
      return;
    }
    const entry = TOPIC_INDEX.find((item) => item.key === k);
    total += entry?.questionCount ?? 0;
    done += Object.keys(state.progress).filter(
      (progressKey) => progressKey.startsWith(k + ':') && state.progress[progressKey],
    ).length;
  });

  const pct = total ? Math.round((done / total) * 100) : 0;
  const fill = document.getElementById('pgFill');
  const text = document.getElementById('pgText');
  const pctEl = document.getElementById('pgPct');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = `${done} / ${total}`;
  if (pctEl) pctEl.textContent = pct + '%';
}
