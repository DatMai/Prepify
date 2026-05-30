import type { DailyQuestion, DailySession } from './types';
import { renderMcqCard } from './mcqCard';
import { renderFibCard } from './fibCard';
import { completeDailyChallenge, fetchDailyStatus } from '../api/streak';
import { isLoggedIn } from '../state/auth';
import { streakState } from '../state/streak';
import { renderStreakBadge } from '../ui/streakBadge';

let overlay: HTMLElement | null = null;
let session: DailySession | null = null;

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

  // Check if already completed today (for logged-in users)
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
  overlay!.innerHTML = '<div class="daily-loading">Đang tải câu hỏi…</div>';

  try {
    const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
    const res = await fetch(`${BASE}/daily`);
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json() as { date: string; questions: DailyQuestion[] };

    session = {
      date: data.date,
      questions: data.questions,
      answers: [],
      currentIdx: 0,
    };

    renderQuestion();
  } catch {
    overlay!.innerHTML = '<div class="daily-error">Không thể tải câu hỏi. Thử lại sau.<br><button class="daily-close-btn" onclick="document.getElementById(\'dailyOverlay\').hidden=true">Đóng</button></div>';
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
        <button class="daily-back-btn" id="dailyBack">← Thoát</button>
        <span class="daily-title">⚡ Daily Challenge · ${formatDate(session.date)}</span>
        <span class="daily-counter">${currentIdx + 1} / ${total}</span>
      </div>
      <div class="daily-progress-bar">
        <div class="daily-progress-fill" style="width:${progress}%"></div>
      </div>
      <div class="daily-card-area" id="dailyCardArea"></div>
      <div class="daily-footer">
        <button class="daily-next-btn" id="dailyNext" disabled>Tiếp theo →</button>
      </div>
    </div>
  `;

  overlay.querySelector('#dailyBack')?.addEventListener('click', closeDaily);

  const cardArea = overlay.querySelector<HTMLElement>('#dailyCardArea');
  const nextBtn = overlay.querySelector<HTMLButtonElement>('#dailyNext');

  function onAnswered(correct: boolean): void {
    session!.answers.push({ questionId: q.id, correct });
    if (nextBtn) {
      nextBtn.disabled = false;
      nextBtn.textContent = currentIdx + 1 >= total ? 'Xem kết quả' : 'Tiếp theo →';
    }
  }

  if (q.type === 'mcq') {
    const card = renderMcqCard(q, (r) => onAnswered(r.correct));
    cardArea?.appendChild(card);
  } else if (q.type === 'fib') {
    const card = renderFibCard(q, (r) => onAnswered(r.allCorrect));
    cardArea?.appendChild(card);
    // Auto-focus first input
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
}

async function showSummary(): Promise<void> {
  if (!overlay || !session) return;

  const correct = session.answers.filter((a) => a.correct).length;
  const total = session.questions.length;
  const loggedIn = isLoggedIn();

  let streakHtml = '';
  let streakAfter = streakState.current;

  if (loggedIn) {
    try {
      const result = await completeDailyChallenge({ date: session.date, score: correct, total });
      streakAfter = result.streak.current;
      // Update streak state
      streakState.current = streakAfter;
      streakState.longest = Math.max(streakState.longest, result.streak.longest);
      renderStreakBadge(streakAfter);
      updateDailyDot(true);
      streakHtml = `
        <div class="daily-streak-info">
          <div>🔥 Streak hiện tại: <strong>${streakAfter} ngày</strong></div>
          <div>🏆 Kỷ lục: <strong>${result.streak.longest} ngày</strong></div>
        </div>
      `;
    } catch (err: unknown) {
      const apiErr = err as { status?: number };
      if (apiErr.status === 409) {
        streakHtml = '<div class="daily-streak-info">Đã ghi nhận lần trước rồi!</div>';
      } else {
        streakHtml = '<div class="daily-streak-info fib-feedback-err">Không thể lưu kết quả.</div>';
      }
    }
  } else {
    streakHtml = `
      <div class="daily-login-cta">
        Đăng nhập để lưu streak!<br>
        <button class="daily-cta-login" id="dailyCTALogin">Đăng nhập</button>
      </div>
    `;
  }

  const emoji = correct === total ? '🎉' : correct >= Math.ceil(total / 2) ? '👍' : '💪';

  overlay.innerHTML = `
    <div class="daily-panel daily-summary">
      <div class="daily-summary-title">⚡ Daily · ${formatDate(session.date)}</div>
      <div class="daily-score">${emoji} ${correct} / ${total}</div>
      ${streakHtml}
      <div class="daily-summary-actions">
        <button class="daily-close-btn" id="dailySummaryClose">Về học tiếp</button>
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
      <div class="daily-summary-title">⚡ Daily Challenge</div>
      <div class="daily-score">✓ Đã hoàn thành hôm nay</div>
      <div class="daily-score-sub">${score} / ${total} đúng</div>
      <div class="daily-streak-info">
        🔥 Streak: <strong>${streak} ngày</strong>
      </div>
      <div class="daily-summary-actions">
        <button class="daily-close-btn" id="dailyDoneClose">Về học tiếp</button>
      </div>
    </div>
  `;
  overlay.querySelector('#dailyDoneClose')?.addEventListener('click', closeDaily);
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
