import { DATA } from '../data/loader';
import { t as defaultT } from '../i18n';
import { esc } from '../render/escape';
import { blockHTML } from '../render/block';
import { dueCount, gradeQuestion, reviewState } from '../state/review';
import type { ReviewQuality, ReviewSchedule } from './scheduler';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface ReviewViewDeps {
  t?: Translate;
  grade?: (
    topic: string,
    sectionIdx: number,
    questionIdx: number,
    quality: ReviewQuality,
  ) => Promise<ReviewSchedule | null>;
}

let overlay: HTMLElement | null = null;
let queue: ReviewSchedule[] = [];
let index = 0;
let done = 0;
let activeDeps: ReviewViewDeps = {};

export function renderReviewBadge(): void {
  const badge = document.getElementById('reviewCount');
  if (badge) badge.textContent = dueCount() > 0 ? String(dueCount()) : '—';
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeReviewOverlay();
    return;
  }
  const grades: Record<string, ReviewQuality> = { '1': 'again', '2': 'hard', '3': 'good' };
  const quality = grades[event.key];
  if (!quality) return;
  const button = overlay?.querySelector<HTMLButtonElement>(
    `.review-grade-btn[data-grade="${quality}"]`,
  );
  if (button && !button.hidden) button.click();
}

function ensureOverlay(t: Translate): HTMLElement {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'review-overlay';
  overlay.innerHTML = `
    <div class="review-box">
      <div class="review-head">
        <h2 class="review-title"></h2>
        <button class="review-close" type="button" aria-label="${esc(t('review.close'))}">✕</button>
      </div>
      <div class="review-body"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.review-close')?.addEventListener('click', closeReviewOverlay);
  return overlay;
}

async function handleGrade(
  item: ReviewSchedule,
  t: Translate,
  quality: ReviewQuality,
): Promise<void> {
  const grade = activeDeps.grade ?? gradeQuestion;
  await grade(item.topic, item.sectionIdx, item.questionIdx, quality);
  done++;
  index++;
  renderCard(t);
  renderReviewBadge();
}

function renderCard(t: Translate): void {
  if (!overlay) return;
  const title = overlay.querySelector('.review-title') as HTMLElement;
  const body = overlay.querySelector('.review-body') as HTMLElement;
  title.textContent =
    queue.length > 0 ? `${t('review.title')} · ${index + 1}/${queue.length}` : t('review.title');

  if (queue.length === 0) {
    body.innerHTML = `<p class="review-empty">${esc(t('review.empty'))}</p>`;
    return;
  }

  if (index >= queue.length) {
    body.innerHTML = `
      <p class="review-summary">${esc(t('review.summary', { done, left: 0 }))}</p>
      <button class="review-done" type="button">${esc(t('review.close'))}</button>`;
    body.querySelector('.review-done')?.addEventListener('click', closeReviewOverlay);
    return;
  }

  const item = queue[index];
  const question = DATA[item.topic]?.sections[item.sectionIdx]?.questions[item.questionIdx];
  if (!question) {
    index++;
    done++;
    renderCard(t);
    return;
  }

  const qid = `review${index}`;
  const answerHTML = question.blocks.map((b, bi) => blockHTML(b, qid, bi)).join('');
  body.innerHTML = `
    <p class="review-question">${esc(question.q)}</p>
    <div class="review-answer" hidden></div>
    <div class="review-actions">
      <button class="review-reveal" type="button">${esc(t('review.reveal'))}</button>
      <div class="review-grades" hidden>
        <button class="review-grade-btn bad" data-grade="again" type="button">${esc(t('review.again'))}</button>
        <button class="review-grade-btn warn" data-grade="hard" type="button">${esc(t('review.hard'))}</button>
        <button class="review-grade-btn ok" data-grade="good" type="button">${esc(t('review.good'))}</button>
      </div>
    </div>`;

  const answer = body.querySelector('.review-answer') as HTMLElement;
  const reveal = body.querySelector('.review-reveal') as HTMLElement;
  const grades = body.querySelector('.review-grades') as HTMLElement;
  reveal.addEventListener('click', () => {
    answer.innerHTML = answerHTML;
    answer.hidden = false;
    reveal.hidden = true;
    grades.hidden = false;
  });

  body.querySelectorAll<HTMLButtonElement>('.review-grade-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const quality = button.dataset.grade as ReviewQuality;
      void handleGrade(item, t, quality);
    });
  });
}

export async function openReviewOverlay(deps: ReviewViewDeps = {}): Promise<void> {
  activeDeps = deps;
  const t = deps.t ?? defaultT;
  queue = Object.values(reviewState.schedules)
    .filter((s) => Date.parse(s.dueAt) <= Date.now())
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  index = 0;
  done = 0;
  ensureOverlay(t);
  overlay!.classList.add('show');
  renderCard(t);
  document.addEventListener('keydown', onKeydown);
}

export function closeReviewOverlay(): void {
  document.removeEventListener('keydown', onKeydown);
  overlay?.classList.remove('show');
}
