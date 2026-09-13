import { RefreshCw, Trophy, Zap } from 'lucide';
import type { DailySession } from './types';
import { renderMcqCard } from './mcqCard';
import { renderFibCard } from './fibCard';
import { completeDailyChallenge, fetchDailyQuestions, fetchDailyStatus } from '../api/streak';
import { isLoggedIn } from '../state/auth';
import { streakState } from '../state/streak';
import { renderStreakBadge } from '../ui/streakBadge';
import { iconMarkup } from '../ui/icon';
import { getLang, t } from '../i18n';
import { api } from '../api/client';
import {
  SYNC_STATE_KEYS,
  isRetryable,
  lastSyncedLabel,
  newSyncEventId,
  readLastSyncedAt,
  runSyncJob,
  syncHintLabel,
  writeLastSyncedAt,
  type SyncUiStatus,
} from '../journey/syncState';

let overlay: HTMLElement | null = null;
let session: DailySession | null = null;
let syncStatus: SyncUiStatus = { state: 'pending', jobId: null, lastSyncedAt: null };
let syncing = false;
let syncTimedOut = false;

export function initDailyView(): void {
  overlay = document.createElement('div');
  overlay.className = 'daily-overlay';
  overlay.id = 'dailyOverlay';
  overlay.hidden = true;
  document.body.appendChild(overlay);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay?.hidden) closeDaily();
  });
}

export async function openDaily(): Promise<void> {
  if (!overlay) initDailyView();
  syncStatus = { ...syncStatus, lastSyncedAt: readLastSyncedAt(window.localStorage) };

  if (isLoggedIn()) {
    try {
      const status = await fetchDailyStatus();
      if (status.completedToday) {
        showAlreadyDone(status.score ?? 0, status.total ?? 5, status.currentStreak ?? 0);
        return;
      }
    } catch {
      // proceed anyway
    }
  }

  overlay!.hidden = false;
  overlay!.innerHTML = `<div class="daily-loading">${t('daily.loading')}</div>`;
  console.debug('[daily] loading started');

  try {
    const data = await fetchDailyQuestions(getLang());

    session = {
      date: data.date,
      challenge: data.challenge,
      questions: data.questions,
      answers: [],
      currentIdx: 0,
    };

    renderQuestion();
    console.debug('[daily] loading completed', { date: data.date, count: data.questions.length });
  } catch (error) {
    console.error('[daily] loading failed', error);
    overlay!.innerHTML = `<div class="daily-error">${t('daily.loadError')}<br><button class="daily-close-btn" id="dailyLoadClose">${t('daily.close')}</button></div>`;
    overlay!.querySelector('#dailyLoadClose')?.addEventListener('click', closeDaily);
  } finally {
    console.debug('[daily] loading settled');
  }
}

export function closeDaily(): void {
  if (overlay) overlay.hidden = true;
  session = null;
}

function renderQuestion(): void {
  if (!overlay || !session) return;
  const { questions, currentIdx } = session;
  const q = questions[currentIdx];
  if (!q) return;

  const total = questions.length;
  const progress = Math.round((currentIdx / total) * 100);

  overlay.innerHTML = `
    <div class="daily-panel">
      <div class="daily-header">
        <button class="daily-back-btn" id="dailyBack">${t('daily.exit')}</button>
        <span class="daily-title">${iconMarkup(Zap)}Daily Challenge · ${formatDate(session.date)}</span>
        <span class="daily-counter">${currentIdx + 1} / ${total}</span>
      </div>
      <div class="daily-progress-bar">
        <div class="daily-progress-fill" style="width:${progress}%"></div>
      </div>
      ${renderSyncControlHtml()}
      <div class="daily-card-area" id="dailyCardArea"></div>
      <div class="daily-footer">
        <button class="daily-next-btn" id="dailyNext" disabled>${t('daily.next')}</button>
      </div>
    </div>
  `;

  overlay.querySelector('#dailyBack')?.addEventListener('click', closeDaily);

  const cardArea = overlay.querySelector<HTMLElement>('#dailyCardArea');
  const nextBtn = overlay.querySelector<HTMLButtonElement>('#dailyNext');

  function onAnswered(answer: DailySession['answers'][number]): void {
    session!.answers.push(answer);
    if (nextBtn) {
      nextBtn.disabled = false;
      nextBtn.textContent = currentIdx + 1 >= total ? t('daily.seeResults') : t('daily.next');
    }
  }

  if (q.type === 'mcq') {
    const card = renderMcqCard(q, (result) => onAnswered({ questionId: q.id, ...result }));
    cardArea?.appendChild(card);
  } else if (q.type === 'fib') {
    const card = renderFibCard(q, (result) => onAnswered({ questionId: q.id, ...result }));
    cardArea?.appendChild(card);
    setTimeout(() => {
      (card.querySelector('.fib-input') as HTMLElement | null)?.focus();
    }, 50);
  }

  nextBtn?.addEventListener('click', () => {
    if (!session) return;
    if (session.currentIdx + 1 >= session.questions.length) {
      void showSummary();
    } else {
      session.currentIdx++;
      renderQuestion();
    }
  });

  bindSyncControl();
}

function renderSyncControlHtml(): string {
  return `
    <div class="daily-sync" data-state="${syncStatus.state}">
      <div class="daily-sync-toolbar">
        <div class="daily-sync-meta">
          <span class="daily-sync-indicator" aria-hidden="true"></span>
          <span class="daily-sync-state" role="status" aria-live="polite">${t(SYNC_STATE_KEYS[syncStatus.state])}</span>
          <span class="daily-sync-last">${lastSyncedLabel(syncStatus.lastSyncedAt, t)}</span>
        </div>
        <div class="daily-sync-actions">
          <button class="daily-sync-btn" id="dailySyncBtn" type="button">${iconMarkup(RefreshCw)}${t('sync.button')}</button>
          <button class="daily-sync-retry" id="dailySyncRetry" type="button" hidden>${t('sync.retry')}</button>
        </div>
      </div>
      <p class="daily-sync-hint">${syncHintLabel(syncStatus, syncTimedOut, t)}</p>
    </div>
  `;
}

function updateSyncControl(): void {
  const control = overlay?.querySelector<HTMLElement>('.daily-sync');
  if (!control) return;
  control.dataset.state = syncStatus.state;
  const state = control.querySelector<HTMLElement>('.daily-sync-state');
  if (state) state.textContent = t(SYNC_STATE_KEYS[syncStatus.state]);
  const last = control.querySelector<HTMLElement>('.daily-sync-last');
  if (last) last.textContent = lastSyncedLabel(syncStatus.lastSyncedAt, t);
  const hint = control.querySelector<HTMLElement>('.daily-sync-hint');
  if (hint) hint.textContent = syncHintLabel(syncStatus, syncTimedOut, t);
  const button = control.querySelector<HTMLButtonElement>('#dailySyncBtn');
  if (button) button.disabled = syncing;
  const retry = control.querySelector<HTMLButtonElement>('#dailySyncRetry');
  if (retry) retry.hidden = !isRetryable(syncStatus.state);
}

function bindSyncControl(): void {
  overlay?.querySelector<HTMLButtonElement>('#dailySyncBtn')?.addEventListener('click', () => {
    void runDailySync();
  });
  overlay?.querySelector<HTMLButtonElement>('#dailySyncRetry')?.addEventListener('click', () => {
    void runDailySync();
  });
  const retry = overlay?.querySelector<HTMLButtonElement>('#dailySyncRetry');
  if (retry) retry.hidden = !isRetryable(syncStatus.state);
}

async function runDailySync(): Promise<void> {
  if (syncing) return;
  syncing = true;
  syncTimedOut = false;
  syncStatus = { state: 'pending', jobId: null, lastSyncedAt: syncStatus.lastSyncedAt };
  updateSyncControl();

  try {
    const result = await runSyncJob({
      requestSync: () => api.journey.requestSync(newSyncEventId()),
      fetchStatus: (jobId) => api.journey.syncStatus(jobId),
      onStatus: (status) => {
        syncStatus = status;
        updateSyncControl();
      },
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      lastSyncedAt: syncStatus.lastSyncedAt,
    });
    syncTimedOut = result.state === 'pending' && result.jobId !== null;
    syncStatus = result;
    if (result.state === 'synced' && result.lastSyncedAt) {
      writeLastSyncedAt(window.localStorage, result.lastSyncedAt);
    }
  } finally {
    syncing = false;
    updateSyncControl();
  }
}

async function showSummary(): Promise<void> {
  if (!overlay || !session) return;

  let correct = 0;
  let total = session.questions.length;
  const loggedIn = isLoggedIn();

  let streakHtml: string;

  if (loggedIn) {
    try {
      const result = await completeDailyChallenge({
        date: session.date,
        challenge: session.challenge,
        answers: session.answers,
      });
      correct = result.score;
      total = result.total;
      const streakAfter = result.streak.current;
      streakState.current = streakAfter;
      streakState.longest = Math.max(streakState.longest, result.streak.longest);
      renderStreakBadge(streakAfter);
      updateDailyDot(true);
      streakHtml = `
        <div class="daily-streak-info">
          <div>${t('daily.streakCurrent', { n: streakAfter })}</div>
          <div>${t('daily.streakBest', { n: result.streak.longest })}</div>
        </div>
      `;
    } catch (err: unknown) {
      const apiErr = err as { status?: number };
      if (apiErr.status === 409) {
        streakHtml = `<div class="daily-streak-info">${t('daily.alreadySaved')}</div>`;
      } else {
        streakHtml = `<div class="daily-streak-info fib-feedback-err">${t('daily.saveFailed')}</div>`;
      }
    }
  } else {
    streakHtml = `
      <div class="daily-login-cta">
        ${t('daily.loginCta')}<br>
        <button class="daily-cta-login" id="dailyCTALogin">${t('daily.login')}</button>
      </div>
    `;
  }

  overlay.innerHTML = `
    <div class="daily-panel daily-summary">
      <div class="daily-summary-title">${iconMarkup(Zap)}Daily · ${formatDate(session.date)}</div>
      <div class="daily-score">${iconMarkup(Trophy)}${correct} / ${total}</div>
      ${streakHtml}
      <div class="daily-summary-actions">
        <button class="daily-close-btn" id="dailySummaryClose">${t('daily.backToStudy')}</button>
      </div>
    </div>
  `;

  overlay.querySelector('#dailySummaryClose')?.addEventListener('click', closeDaily);
  overlay.querySelector('#dailyCTALogin')?.addEventListener('click', () => {
    closeDaily();
    document.getElementById('authBtn')?.click();
  });
}

function showAlreadyDone(score: number, total: number, streak: number): void {
  if (!overlay) return;
  overlay.hidden = false;
  overlay.innerHTML = `
    <div class="daily-panel daily-summary">
      <div class="daily-summary-title">${iconMarkup(Zap)}Daily Challenge</div>
      ${renderSyncControlHtml()}
      <div class="daily-score">${t('daily.completedToday')}</div>
      <div class="daily-score-sub">${t('daily.scoreCorrect', { n: score, total })}</div>
      <div class="daily-streak-info">
        ${t('daily.streakSimple', { n: streak })}
      </div>
      <div class="daily-summary-actions">
        <button class="daily-close-btn" id="dailyDoneClose">${t('daily.backToStudy')}</button>
      </div>
    </div>
  `;
  overlay.querySelector('#dailyDoneClose')?.addEventListener('click', closeDaily);
  bindSyncControl();
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function updateDailyDot(done: boolean): void {
  const dot = document.getElementById('dailyDot');
  const btn = document.getElementById('dailyBtn');
  if (dot) dot.classList.toggle('active', done);
  if (btn) btn.classList.toggle('done', done);
}
