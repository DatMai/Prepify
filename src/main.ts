import './styles/main.css';
import { bindEvents } from './events';
import { render } from './render/content';
import { loadProgress } from './state/progress';
import { restoreSession, isLoggedIn } from './state/auth';
import { initAuthModal, bindAuthBtn, setProfileOpener } from './ui/authModal';
import { loadStreak, resetStreak } from './state/streak';
import { initLeaderboardModal, openLeaderboard } from './ui/leaderboard';
import { initDailyBtn, refreshDailyDot } from './ui/dailyBtn';
import { initProfileModal, openProfile } from './ui/profileModal';
import { showToast } from './ui/toast';

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
  initAuthModal(() => {
    render();
    if (isLoggedIn()) {
      void loadStreak();
      void refreshDailyDot();
    }
  });
  bindAuthBtn();
  setProfileOpener(openProfile);
  initProfileModal(() => resetStreak());
  initLeaderboardModal();
  initDailyBtn();

  document.getElementById('lbBtn')?.addEventListener('click', () => {
    void openLeaderboard();
  });

  await restoreSession();
  await loadProgress();
  bindEvents();
  render();

  if (isLoggedIn()) {
    void loadStreak();
    void refreshDailyDot();
  }
}

void init();
