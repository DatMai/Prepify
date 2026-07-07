import './styles/main.css';
import { bindEvents } from './events';
import { render } from './render/content';
import { renderTopics } from './render/sidebar';
import { loadProgress } from './state/progress';
import { restoreSession, isLoggedIn } from './state/auth';
import { initAuthModal, bindAuthBtn, setProfileOpener, setPendingResetToken, showModal, updateAuthBtn } from './ui/authModal';
import { loadFavorites } from './state/favorites';
import { loadStreak, resetStreak } from './state/streak';
import { initLeaderboardModal, openLeaderboard } from './ui/leaderboard';
import { initDailyBtn, refreshDailyDot } from './ui/dailyBtn';
import { initProfileModal, openProfile } from './ui/profileModal';
import { showToast } from './ui/toast';
import { showQuizLauncher } from './quiz/launcher';
import { repaintQuiz } from './quiz/quizView';
import { getLang, setLang, t, type Lang } from './i18n';

function applyLang(): void {
  const langBtn = document.getElementById('langBtn');
  if (langBtn) langBtn.textContent = t('topbar.langSwitch');

  const quizToggle = document.getElementById('quizToggle');
  if (quizToggle) quizToggle.textContent = t('topbar.quizMode');

  updateAuthBtn();
  renderTopics();

  // Re-render quiz launcher if it's open
  if (document.getElementById('quizLauncher')?.classList.contains('show')) {
    showQuizLauncher();
  }

  // Re-render quiz overlay current card if visible
  repaintQuiz();
}

async function init(): Promise<void> {
  const params = new URLSearchParams(window.location.search);

  const oauthToken = params.get('auth_token');
  if (oauthToken) {
    localStorage.setItem('quiz:token', oauthToken);
    window.history.replaceState({}, '', window.location.pathname);
  }

  const oauthError = params.get('oauth_error');
  if (oauthError) {
    window.history.replaceState({}, '', window.location.pathname);
    const msg = oauthError === 'not_configured'
      ? 'OAuth chưa được cấu hình. Vui lòng điền credentials vào server/.env.'
      : 'Đăng nhập thất bại. Vui lòng thử lại.';
    showToast(msg, 'error');
  }

  const emailVerified = params.get('email_verified');
  if (emailVerified !== null) {
    window.history.replaceState({}, '', window.location.pathname);
    if (emailVerified === '1') {
      showToast('Email đã được xác minh thành công!', 'ok');
    } else {
      showToast('Link xác minh không hợp lệ hoặc đã hết hạn.', 'error');
    }
  }

  const resetTokenParam = params.get('reset_token');
  if (resetTokenParam) {
    window.history.replaceState({}, '', window.location.pathname);
    setPendingResetToken(resetTokenParam);
  }

  // Init lang toggle button
  const langBtn = document.getElementById('langBtn');
  if (langBtn) {
    langBtn.textContent = t('topbar.langSwitch');
    langBtn.addEventListener('click', () => {
      const next: Lang = getLang() === 'vi' ? 'en' : 'vi';
      setLang(next);
      applyLang();
    });
  }

  initAuthModal(() => {
    render();
    if (isLoggedIn()) {
      void loadStreak();
      void refreshDailyDot();
    }
  });
  bindAuthBtn();
  if (resetTokenParam) showModal('reset');
  setProfileOpener(openProfile);
  initProfileModal(() => resetStreak());
  initLeaderboardModal();
  initDailyBtn();

  document.getElementById('lbBtn')?.addEventListener('click', () => {
    void openLeaderboard();
  });

  await restoreSession();
  await loadProgress();
  loadFavorites();
  bindEvents();
  render();

  if (isLoggedIn()) {
    void loadStreak();
    void refreshDailyDot();
  }
}

void init();
