import { DATA, ORDER, TOPIC_INDEX } from '../data/loader';
import { state } from '../state/progress';
import { isMcqEligible } from './mcq';
import { startQuiz } from './quizView';
import { t } from '../i18n';
import type { QuizConfig, QuizMode, QuestionSet } from './types';

export function showQuizLauncher(): void {
  let el = document.getElementById('quizLauncher');
  if (!el) {
    el = document.createElement('div');
    el.id = 'quizLauncher';
    el.className = 'modal-overlay';
    document.body.appendChild(el);
  }

  const currentTopic = state.topic;
  const topicOptions = ORDER.map((key) => {
    const entry = TOPIC_INDEX.find((t) => t.key === key)!;
    return `<option value="${key}" ${key === currentTopic ? 'selected' : ''}>${entry.label}</option>`;
  }).join('');

  el.innerHTML = `
    <div class="modal quiz-launcher">
      <button class="modal-close" id="qlClose">✕</button>
      <h2>${t('ql.title')}</h2>

      <div class="field">
        <label class="ql-section-label">${t('ql.topicLabel')}</label>
        <select id="qlTopic" class="ql-select">${topicOptions}</select>
      </div>

      <div style="margin-bottom:16px">
        <div class="ql-section-label">${t('ql.modeLabel')}</div>
        <div class="quiz-radio-group">
          <label class="quiz-radio-label">
            <input type="radio" name="qlMode" value="flashcard" checked> ${t('ql.flashcard')}
          </label>
          <label class="quiz-radio-label" id="qlMcqLabel">
            <input type="radio" name="qlMode" value="mcq" id="qlMcqRadio"> ${t('ql.mcq')}
            <span id="qlMcqHint" style="font-size:12px;color:var(--faint);margin-left:4px"></span>
          </label>
        </div>
      </div>

      <div style="margin-bottom:24px">
        <div class="ql-section-label">${t('ql.questionsLabel')}</div>
        <div class="quiz-radio-group" id="qlSetGroup"></div>
      </div>

      <button class="modal-submit" id="qlStart">${t('ql.start')}</button>
    </div>`;

  updateSetOptions(el, currentTopic);
  updateMcqState(el, currentTopic);

  el.classList.add('show');

  document.getElementById('qlClose')?.addEventListener('click', () => el!.classList.remove('show'));
  el.addEventListener('click', (e) => {
    if (e.target === el) el!.classList.remove('show');
  });

  document.getElementById('qlTopic')?.addEventListener('change', (e) => {
    const key = (e.target as HTMLSelectElement).value;
    updateSetOptions(el!, key);
    updateMcqState(el!, key);
  });

  document.getElementById('qlStart')?.addEventListener('click', () => {
    const topicKey = (document.getElementById('qlTopic') as HTMLSelectElement).value;
    const modeEl = document.querySelector('input[name="qlMode"]:checked') as HTMLInputElement;
    const setEl = document.querySelector('input[name="qlSet"]:checked') as HTMLInputElement;
    if (!modeEl || !setEl) return;

    const mode = modeEl.value as QuizMode;
    const questionSet = setEl.value as QuestionSet;
    const config: QuizConfig = { topicKey, mode, questionSet, randomCount: 20 };

    el!.classList.remove('show');
    startQuiz(config);
  });
}

function updateSetOptions(el: HTMLElement, topicKey: string): void {
  const topic = DATA[topicKey];
  const entry = TOPIC_INDEX.find((e) => e.key === topicKey)!;
  const total = entry.questionCount;

  let unlearned = 0;
  topic.sections.forEach((sec, si) => {
    sec.questions.forEach((_q, qi) => {
      if (!state.progress[`${topicKey}:${si}:${qi}`]) unlearned++;
    });
  });

  const randomCount = Math.min(20, total);

  const group = el.querySelector('#qlSetGroup')!;
  group.innerHTML = `
    <label class="quiz-radio-label">
      <input type="radio" name="qlSet" value="all" checked> ${t('ql.allQ', { n: total })}
    </label>
    <label class="quiz-radio-label">
      <input type="radio" name="qlSet" value="unlearned"> ${t('ql.unlearnedQ', { n: unlearned })}
    </label>
    <label class="quiz-radio-label">
      <input type="radio" name="qlSet" value="random"> ${t('ql.randomQ', { n: randomCount })}
    </label>`;
}

function updateMcqState(el: HTMLElement, topicKey: string): void {
  const eligible = countMcqEligible(topicKey);
  const label = el.querySelector('#qlMcqLabel') as HTMLElement;
  const radio = el.querySelector('#qlMcqRadio') as HTMLInputElement;
  const hint = el.querySelector('#qlMcqHint') as HTMLElement;

  if (eligible < 4) {
    label.classList.add('disabled');
    label.title = t('ql.mcqDisabled');
    radio.disabled = true;
    hint.textContent = t('ql.mcqNeedMore', { n: eligible });
    const flashcard = el.querySelector(
      'input[name="qlMode"][value="flashcard"]',
    ) as HTMLInputElement;
    if (flashcard) flashcard.checked = true;
  } else {
    label.classList.remove('disabled');
    label.title = '';
    radio.disabled = false;
    hint.textContent = t('ql.mcqEligible', { n: eligible });
  }
}

function countMcqEligible(topicKey: string): number {
  const topic = DATA[topicKey];
  let count = 0;
  topic.sections.forEach((s) =>
    s.questions.forEach((q) => {
      if (isMcqEligible(q)) count++;
    }),
  );
  return count;
}
