import './styles/main.css';
import { bindEvents } from './events';
import { render } from './render/content';
import { renderTopics } from './render/sidebar';
import { loadProgress } from './state/progress';
import { auth, adoptToken, restoreSession, isLoggedIn } from './state/auth';
import {
  initAuthModal,
  bindAuthBtn,
  setProfileOpener,
  setPendingResetToken,
  showModal,
  updateAuthBtn,
} from './ui/authModal';
import { loadFavorites } from './state/favorites';
import { loadStreak, resetStreak } from './state/streak';
import { initLeaderboardModal, openLeaderboard } from './ui/leaderboard';
import { initDailyBtn, refreshDailyDot } from './ui/dailyBtn';
import { initJourneyBtn } from './ui/journeyBtn';
import { openJourney, repaintJourney } from './journey/journeyView';
import { initProfileModal, openProfile } from './ui/profileModal';
import { showToast } from './ui/toast';
import { showQuizLauncher } from './quiz/launcher';
import { repaintQuiz } from './quiz/quizView';
import { getLang, setLang, t, type Lang } from './i18n';
import { clearLibrary, loadLibrary } from './data/loader';

function isAdmin(): boolean {
  return auth.user?.role === 'admin';
}

function updateAccessUI(): void {
  document.querySelectorAll<HTMLElement>('.admin-only').forEach((element) => {
    element.hidden = !isAdmin();
  });
}

function showHome(updateHistory = true): void {
  document.getElementById('homeView')?.removeAttribute('hidden');
  document.getElementById('libraryView')?.setAttribute('hidden', '');
  document.getElementById('libraryNav')?.classList.remove('is-active');
  if (updateHistory && window.location.hash !== '#home') window.history.pushState({}, '', '#home');
}

async function showLibrary(updateHistory = true): Promise<void> {
  if (!isAdmin()) {
    showModal('login');
    return;
  }
  try {
    await loadLibrary();
    document.getElementById('homeView')?.setAttribute('hidden', '');
    document.getElementById('libraryView')?.removeAttribute('hidden');
    document.getElementById('libraryNav')?.classList.add('is-active');
    render();
    if (updateHistory && window.location.hash !== '#library')
      window.history.pushState({}, '', '#library');
  } catch {
    showToast(t('library.loadError'), 'error');
  }
}

function applyLang(): void {
  document.documentElement.lang = getLang();
  const langBtn = document.getElementById('langBtn');
  if (langBtn) langBtn.textContent = t('topbar.langSwitch');

  const quizToggle = document.getElementById('quizToggle');
  if (quizToggle) quizToggle.textContent = t('topbar.quizMode');

  const search = document.getElementById('search') as HTMLInputElement | null;
  if (search) search.placeholder = t('topbar.search');
  const favorite = document.getElementById('favFilterBtn');
  if (favorite) favorite.title = t('topbar.favoriteTitle');
  const daily = document.getElementById('dailyBtn');
  if (daily?.firstChild) daily.firstChild.textContent = `${t('topbar.daily')} `;
  const leaderboard = document.getElementById('lbBtn');
  if (leaderboard) leaderboard.textContent = t('topbar.leaderboard');
  const sidebarHint = document.getElementById('sidebarHint');
  if (sidebarHint) sidebarHint.textContent = t('library.sidebarHint');

  const libraryNav = document.getElementById('libraryNav');
  if (libraryNav) libraryNav.textContent = t('nav.library');
  const journeyNav = document.getElementById('journeyNav');
  if (journeyNav) journeyNav.textContent = t('nav.journey');
  const homeKicker = document.getElementById('homeKicker');
  if (homeKicker) homeKicker.textContent = t('home.kicker');
  const homeTitle = document.getElementById('homeTitle');
  if (homeTitle) homeTitle.textContent = t('home.title');
  updateAuthBtn();
  if (isAdmin()) renderTopics();

  // Re-render quiz launcher if it's open
  if (document.getElementById('quizLauncher')?.classList.contains('show')) {
    showQuizLauncher();
  }

  // Re-render quiz overlay current card if visible
  repaintQuiz();
  repaintJourney();
}

let languageSwitchInFlight = false;

async function toggleLanguage(): Promise<void> {
  if (languageSwitchInFlight) return;
  languageSwitchInFlight = true;

  const langBtn = document.getElementById('langBtn') as HTMLButtonElement | null;
  if (langBtn) langBtn.disabled = true;
  const previous = getLang();
  const next: Lang = previous === 'vi' ? 'en' : 'vi';

  try {
    if (isAdmin()) await loadLibrary(next);
    setLang(next);
    applyLang();
    if (isAdmin() && !document.getElementById('libraryView')?.hasAttribute('hidden')) render();
  } catch (error) {
    console.error('Language switch failed', error);
    setLang(previous);
    applyLang();
    showToast(t('library.loadError'), 'error');
  } finally {
    if (langBtn) langBtn.disabled = false;
    languageSwitchInFlight = false;
  }
}

async function init(): Promise<void> {
  const params = new URLSearchParams(window.location.search);

  const oauthToken = params.get('auth_token');
  if (oauthToken) {
    adoptToken(oauthToken);
    window.history.replaceState({}, '', window.location.pathname);
  }

  const oauthError = params.get('oauth_error');
  if (oauthError) {
    window.history.replaceState({}, '', window.location.pathname);
    const msg =
      oauthError === 'not_configured' ? t('auth.oauthNotConfigured') : t('auth.loginFailed');
    showToast(msg, 'error');
  }

  const emailVerified = params.get('email_verified');
  if (emailVerified !== null) {
    window.history.replaceState({}, '', window.location.pathname);
    if (emailVerified === '1') {
      showToast(t('auth.emailVerified'), 'ok');
    } else {
      showToast(t('auth.emailVerifyInvalid'), 'error');
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
    langBtn.addEventListener('click', () => void toggleLanguage());
  }
  window.addEventListener('prepify:toggle-language', () => void toggleLanguage());

  initAuthModal(async () => {
    updateAccessUI();
    if (isAdmin()) {
      await loadLibrary();
      if (window.location.hash === '#library') await showLibrary(false);
    }
    if (isLoggedIn()) {
      void loadStreak();
      void refreshDailyDot();
    }
  });
  bindAuthBtn();
  if (resetTokenParam) showModal('reset');
  setProfileOpener(openProfile);
  initProfileModal(() => {
    resetStreak();
    clearLibrary();
    updateAccessUI();
    showHome();
  });
  initLeaderboardModal();
  initDailyBtn();
  initJourneyBtn();

  document.getElementById('homeNav')?.addEventListener('click', () => showHome());
  document.getElementById('libraryNav')?.addEventListener('click', () => void showLibrary());
  document.getElementById('journeyNav')?.addEventListener('click', () => void openJourney());

  document.getElementById('lbBtn')?.addEventListener('click', () => {
    void openLeaderboard();
  });

  applyLang();
  await restoreSession();
  updateAuthBtn();
  updateAccessUI();
  if (isAdmin()) await loadLibrary();
  await loadProgress();
  loadFavorites();
  bindEvents();
  if (window.location.hash === '#library') await showLibrary(false);
  else showHome(false);

  if (isLoggedIn()) {
    void loadStreak();
    void refreshDailyDot();
  }

  if (window.location.hash === '#journey') {
    await openJourney(false);
  }

  window.addEventListener('popstate', () => {
    if (window.location.hash === '#library') void showLibrary(false);
    else if (window.location.hash !== '#journey') showHome(false);
  });
}

void init();
