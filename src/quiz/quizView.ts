import { buildSession } from './session';
import { renderFlashcard } from './flashcard';
import { generateMcqData, renderMcq } from './mcq';
import { toggleProgress, state } from '../state/progress';
import { updateGlobalProgress } from '../render/sidebar';
import { runCode } from '../render/runCode';
import { DATA } from '../data/loader';
import type { QuizConfig, QuizSession, FlashcardGrade, McqData } from './types';

let session: QuizSession | null = null;
let overlayEl: HTMLElement | null = null;
let isFlipped = false;
const mcqCache: Record<string, McqData> = {};

export function startQuiz(config: QuizConfig): void {
  session = buildSession(config, state.progress);
  if (session.questions.length === 0) {
    alert('Bạn đã học hết rồi! Chọn "Tất cả" để ôn lại.');
    return;
  }
  Object.keys(mcqCache).forEach(k => delete mcqCache[k]);
  ensureOverlay();
  isFlipped = false;
  renderCurrentCard();
  overlayEl!.classList.add('show');
  document.addEventListener('keydown', handleKeydown);
}

export function exitQuiz(): void {
  overlayEl?.classList.remove('show');
  document.removeEventListener('keydown', handleKeydown);
  session = null;
  isFlipped = false;
  updateGlobalProgress();
}

function ensureOverlay(): void {
  if (overlayEl) {
    // Reset nav for new session
    const nav = overlayEl.querySelector('.quiz-nav');
    if (nav) nav.innerHTML = `
      <button class="quiz-btn quiz-prev">← Trước</button>
      <button class="quiz-btn quiz-next" disabled>Tiếp →</button>`;
    return;
  }

  overlayEl = document.createElement('div');
  overlayEl.className = 'quiz-overlay';
  overlayEl.innerHTML = `
    <div class="quiz-header">
      <button class="quiz-exit-btn">← Thoát</button>
      <div class="quiz-meta"></div>
      <div class="quiz-counter"></div>
      <div class="quiz-hprogress"><div class="quiz-hprogress-fill"></div></div>
    </div>
    <div class="quiz-content"></div>
    <div class="quiz-nav">
      <button class="quiz-btn quiz-prev">← Trước</button>
      <button class="quiz-btn quiz-next" disabled>Tiếp →</button>
    </div>`;

  document.body.appendChild(overlayEl);

  overlayEl.querySelector('.quiz-exit-btn')?.addEventListener('click', () => {
    if (session && Object.keys(session.answers).length > 0) {
      if (confirm('Thoát quiz? Progress đã grade sẽ được lưu.')) exitQuiz();
    } else {
      exitQuiz();
    }
  });

  overlayEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('quiz-prev') || target.closest('.quiz-prev')) {
      if (session && session.currentIdx > 0) {
        session.currentIdx--;
        isFlipped = false;
        renderCurrentCard();
      }
    } else if (target.classList.contains('quiz-next') || target.closest('.quiz-next')) {
      if (!session) return;
      const btn = overlayEl!.querySelector('.quiz-next') as HTMLButtonElement;
      if (btn?.disabled) return;
      if (session.currentIdx === session.questions.length - 1) {
        showSummary();
      } else {
        session.currentIdx++;
        isFlipped = false;
        renderCurrentCard();
      }
    }
  });
}

function renderCurrentCard(): void {
  if (!session || !overlayEl) return;
  const { config, questions, currentIdx } = session;
  const qInfo = questions[currentIdx];
  const topic = DATA[qInfo.topicKey];
  const q = topic.sections[qInfo.sectionIdx].questions[qInfo.questionIdx];

  // Update header
  overlayEl.querySelector('.quiz-meta')!.textContent =
    `${topic.label} · ${config.mode === 'flashcard' ? 'Flashcard' : 'Trắc nghiệm'}`;
  overlayEl.querySelector('.quiz-counter')!.textContent =
    `${currentIdx + 1} / ${questions.length}`;
  const pct = ((currentIdx + 1) / questions.length) * 100;
  (overlayEl.querySelector('.quiz-hprogress-fill') as HTMLElement).style.width = `${pct}%`;

  const contentEl = overlayEl.querySelector('.quiz-content')!;
  contentEl.scrollTop = 0;
  const answer = session.answers[qInfo.progressKey];
  const answered = !!answer;

  if (config.mode === 'flashcard') {
    contentEl.innerHTML = renderFlashcard(q, qInfo.progressKey, isFlipped);

    // Flip on click (not on grade buttons)
    contentEl.querySelector('.flip-card')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.grade-btn')) return;
      if (!isFlipped) {
        isFlipped = true;
        contentEl.querySelector('.flip-card')?.classList.add('flipped');
      }
    });

    // Grade buttons
    contentEl.querySelectorAll('.grade-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (answered) return;
        const grade = Number((btn as HTMLElement).dataset.grade) as FlashcardGrade;
        handleFlashcardGrade(grade);
      });
    });

    // Run buttons in code blocks
    contentEl.querySelectorAll<HTMLButtonElement>('.run-btn[data-cid]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = btn.getAttribute('data-cid');
        if (cid) runCode(cid);
      });
    });

  } else {
    // MCQ
    if (!mcqCache[qInfo.progressKey]) {
      mcqCache[qInfo.progressKey] = generateMcqData(q, qInfo.topicKey);
    }
    const mcqData = mcqCache[qInfo.progressKey];
    const selectedIdx = answer?.selectedIdx ?? -1;
    contentEl.innerHTML = renderMcq(q, mcqData, answered, selectedIdx);

    if (!answered) {
      contentEl.querySelectorAll('.mcq-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number((btn as HTMLElement).dataset.idx);
          handleMcqSelect(idx, mcqData, qInfo.progressKey);
        });
      });
    }
  }

  updateNav();
}

function updateNav(): void {
  if (!session || !overlayEl) return;
  const { currentIdx, questions, answers } = session;
  const qInfo = questions[currentIdx];
  const answered = !!answers[qInfo.progressKey];

  const prevBtn = overlayEl.querySelector('.quiz-prev') as HTMLButtonElement;
  const nextBtn = overlayEl.querySelector('.quiz-next') as HTMLButtonElement;
  if (prevBtn) prevBtn.disabled = currentIdx === 0;
  if (nextBtn) {
    nextBtn.disabled = !answered;
    nextBtn.textContent = currentIdx === questions.length - 1 ? 'Kết quả →' : 'Tiếp →';
  }
}

function handleFlashcardGrade(grade: FlashcardGrade): void {
  if (!session) return;
  const qInfo = session.questions[session.currentIdx];
  session.answers[qInfo.progressKey] = { grade };

  if (grade === 3) void toggleProgress(qInfo.progressKey, true);
  else if (grade === 1) void toggleProgress(qInfo.progressKey, false);

  updateNav();
}

function handleMcqSelect(selectedIdx: number, mcqData: McqData, progressKey: string): void {
  if (!session) return;
  const isCorrect = selectedIdx === mcqData.correctIdx;
  session.answers[progressKey] = { selectedIdx, correctIdx: mcqData.correctIdx, isCorrect };
  if (isCorrect) void toggleProgress(progressKey, true);
  renderCurrentCard();
}

function showSummary(): void {
  if (!session || !overlayEl) return;
  const { config, answers, questions, startedAt } = session;
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  const timeStr = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
    : `${elapsed}s`;

  let statsHTML = '';
  if (config.mode === 'flashcard') {
    const grades = { 1: 0, 2: 0, 3: 0 };
    Object.values(answers).forEach(a => { if (a.grade) grades[a.grade as 1 | 2 | 3]++; });
    const unanswered = questions.length - Object.keys(answers).length;
    statsHTML = `
      <div class="summary-stats">
        <div class="stat-card">
          <div class="stat-value" style="color:var(--ok)">${grades[3]}</div>
          <div class="stat-label">Nhớ rồi ✅</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--warn)">${grades[2]}</div>
          <div class="stat-label">Phân vân 🤔</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--bad)">${grades[1] + unanswered}</div>
          <div class="stat-label">Chưa nhớ 😰</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${timeStr}</div>
          <div class="stat-label">Thời gian</div>
        </div>
      </div>`;
  } else {
    const total = questions.length;
    const correct = Object.values(answers).filter(a => a.isCorrect).length;
    const pct = Math.round((correct / total) * 100);
    statsHTML = `
      <div class="summary-stats">
        <div class="stat-card">
          <div class="stat-value" style="color:var(--ok)">${correct}/${total}</div>
          <div class="stat-label">Đúng</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--accent)">${pct}%</div>
          <div class="stat-label">Tỉ lệ</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${timeStr}</div>
          <div class="stat-label">Thời gian</div>
        </div>
      </div>`;
  }

  const savedConfig = session.config;
  const contentEl = overlayEl.querySelector('.quiz-content')!;
  contentEl.innerHTML = `
    <div class="quiz-summary">
      <h2>Kết quả</h2>
      ${statsHTML}
      <div style="display:flex;gap:12px;justify-content:center;margin-top:8px">
        <button class="quiz-btn" id="quizSummaryRestart">Làm lại</button>
        <button class="modal-submit" style="width:auto;padding:11px 28px" id="quizSummaryExit">Về study mode</button>
      </div>
    </div>`;

  const nav = overlayEl.querySelector('.quiz-nav');
  if (nav) nav.innerHTML = '';

  document.getElementById('quizSummaryRestart')?.addEventListener('click', () => {
    exitQuiz();
    startQuiz(savedConfig);
  });
  document.getElementById('quizSummaryExit')?.addEventListener('click', exitQuiz);
}

function handleKeydown(e: KeyboardEvent): void {
  if (!session) return;
  const { config } = session;
  const qInfo = session.questions[session.currentIdx];
  const answer = session.answers[qInfo.progressKey];
  const answered = !!answer;

  if (e.key === 'Escape') {
    exitQuiz();
    return;
  }

  if (config.mode === 'flashcard') {
    if (!isFlipped && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      isFlipped = true;
      overlayEl?.querySelector('.flip-card')?.classList.add('flipped');
    } else if (isFlipped && !answered) {
      if (e.key === '1') handleFlashcardGrade(1);
      else if (e.key === '2') handleFlashcardGrade(2);
      else if (e.key === '3') handleFlashcardGrade(3);
    }
  } else {
    if (!answered) {
      const mcqData = mcqCache[qInfo.progressKey];
      if (mcqData) {
        const keyMap: Record<string, number> = { a: 0, A: 0, b: 1, B: 1, c: 2, C: 2, d: 3, D: 3 };
        if (e.key in keyMap) {
          e.preventDefault();
          handleMcqSelect(keyMap[e.key], mcqData, qInfo.progressKey);
        }
      }
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      overlayEl?.querySelector<HTMLButtonElement>('.quiz-next:not([disabled])')?.click();
    }
  }

  // Navigation shortcuts (only after answering current card)
  if (answered) {
    if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') {
      overlayEl?.querySelector<HTMLButtonElement>('.quiz-next:not([disabled])')?.click();
    }
  }
  if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'P') {
    overlayEl?.querySelector<HTMLButtonElement>('.quiz-prev:not([disabled])')?.click();
  }
}
