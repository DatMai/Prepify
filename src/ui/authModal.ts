import { api, ApiError } from '../api/client';
import { setSession, clearSession, auth } from '../state/auth';
import { loadProgress, state } from '../state/progress';
import { render } from '../render/content';
import { showToast } from './toast';
import { checkStrength } from './passwordStrength';
import { t } from '../i18n';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

let _openProfile: (() => void) | null = null;
export function setProfileOpener(fn: () => void): void {
  _openProfile = fn;
}

type Mode = 'login' | 'register' | 'forgot' | 'reset';

let overlay: HTMLElement | null = null;
let onAuthChange: (() => void) | null = null;

let _pendingResetToken = '';

export function setPendingResetToken(token: string): void {
  _pendingResetToken = token;
}

export function initAuthModal(onChange: () => void): void {
  onAuthChange = onChange;
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = buildModal('login');
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideModal();
  });

  overlay.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const mode = overlay!.querySelector('.modal')?.getAttribute('data-mode') as Mode;
    if (el.id === 'authPass' && mode === 'register') {
      updateStrengthMeter(el.value);
    }
    if (el.id === 'newPassword' && mode === 'reset') {
      updateStrengthMeter(el.value);
    }
  });

  bindModal();
  updateAuthBtn();
}

function strengthMeterHtml(): string {
  return `
  <div class="strength-meter">
    <div class="strength-bar"><div class="strength-fill" id="strengthFill" data-score="0"></div></div>
    <div class="strength-rules" id="strengthRules">
      <span class="rule" data-pass="false">${t('pw.chars')}</span>
      <span class="rule" data-pass="false">${t('pw.upper')}</span>
      <span class="rule" data-pass="false">${t('pw.lower')}</span>
      <span class="rule" data-pass="false">${t('pw.digit')}</span>
      <span class="rule" data-pass="false">${t('pw.special')}</span>
    </div>
  </div>`;
}

export function buildModal(mode: Mode): string {
  const wrap = (inner: string) =>
    `<div class="modal" data-mode="${mode}"><button class="modal-close" id="modalClose">✕</button>${inner}</div>`;

  if (mode === 'forgot') {
    return wrap(`
      <h2>${t('auth.forgotTitle')}</h2>
      <p>${t('auth.forgotInstructions')}</p>
      <div class="field"><label>${t('auth.emailLabel')}</label><input id="forgotEmail" type="email" placeholder="you@example.com" autocomplete="email" /></div>
      <div class="modal-error" id="authError"></div>
      <div class="forgot-methods">
        <button id="forgotByEmailBtn">${t('auth.sendResetLink')}</button>
      </div>
      <div class="modal-switch"><a id="goLogin">${t('auth.backToLogin')}</a></div>
    `);
  }

  if (mode === 'reset') {
    return wrap(`
      <h2>${t('auth.resetTitle')}</h2>
      <div class="field"><label>${t('auth.newPasswordLabel')}</label><input id="newPassword" type="password" placeholder="••••••••" autocomplete="new-password" /></div>
      ${strengthMeterHtml()}
      <div class="field"><label>${t('auth.confirmPasswordLabel')}</label><input id="confirmPassword" type="password" placeholder="••••••••" autocomplete="new-password" /></div>
      <div class="modal-error" id="authError"></div>
      <button class="modal-submit" id="authSubmit" disabled>${t('auth.resetBtn')}</button>
    `);
  }

  const isLogin = mode === 'login';
  return wrap(`
    <h2>${isLogin ? t('auth.loginTitle') : t('auth.registerTitle')}</h2>
    <p>${isLogin ? t('auth.loginTagline') : t('auth.registerTagline')}</p>
    ${
      isLogin
        ? `
    <div class="oauth-btns">
      <a class="oauth-btn google" href="${API_BASE}/auth/google">
        <img src="/icons/google.svg" alt="" /> ${t('auth.continueGoogle')}
      </a>
      <a class="oauth-btn facebook" href="${API_BASE}/auth/facebook">
        <img src="/icons/facebook.svg" alt="" /> ${t('auth.continueFb')}
      </a>
    </div>
    <div class="or-divider"><span>${t('auth.or')}</span></div>
    `
        : ''
    }
    ${!isLogin ? `<div class="field"><label>${t('auth.displayNameLabel')}</label><input id="authName" placeholder="${t('auth.displayNamePlaceholder')}" autocomplete="name" /></div>` : ''}
    <div class="field"><label>${t('auth.emailLabel')}</label><input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email" /></div>
    <div class="field"><label>${t('auth.passwordLabel')}</label><input id="authPass" type="password" placeholder="${isLogin ? '••••••' : t('auth.passwordPlaceholder')}" autocomplete="${isLogin ? 'current-password' : 'new-password'}" /></div>
    ${!isLogin ? strengthMeterHtml() : ''}
    ${isLogin ? `<div class="forgot-link"><a id="goForgot">${t('auth.forgotLink')}</a></div>` : ''}
    <div class="modal-error" id="authError"></div>
    <button class="modal-submit" id="authSubmit" ${!isLogin ? 'disabled' : ''}>${isLogin ? t('auth.loginBtn') : t('auth.registerBtn')}</button>
    <div class="modal-switch">
      ${isLogin ? t('auth.switchToRegister') : t('auth.switchToLogin')}
    </div>
  `);
}

function updateStrengthMeter(password: string): void {
  const result = checkStrength(password);
  const fill = overlay!.querySelector('#strengthFill') as HTMLElement | null;
  const rules = overlay!.querySelectorAll('#strengthRules .rule');
  const btn = overlay!.querySelector('#authSubmit') as HTMLButtonElement | null;

  if (fill) fill.dataset.score = String(result.score);
  rules.forEach((el, i) => ((el as HTMLElement).dataset.pass = String(result.passed[i])));
  if (btn) btn.disabled = result.score < 5;
}

function bindModal(): void {
  if (!overlay) return;

  overlay.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;

    if (el.id === 'modalClose') {
      hideModal();
      return;
    }

    if (el.id === 'modeSwitch') {
      const current = overlay!.querySelector('.modal')?.getAttribute('data-mode') as Mode;
      overlay!.innerHTML = buildModal(current === 'login' ? 'register' : 'login');
      return;
    }

    if (el.id === 'authSubmit') {
      void submitAuth();
    }

    if (el.id === 'goForgot') {
      overlay!.innerHTML = buildModal('forgot');
      return;
    }

    if (el.id === 'goLogin') {
      overlay!.innerHTML = buildModal('login');
      return;
    }

    if (el.id === 'forgotByEmailBtn') {
      void handleForgotByEmail();
      return;
    }
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const mode = overlay?.querySelector('.modal')?.getAttribute('data-mode') as Mode | null;
      if (mode === 'forgot') {
        void handleForgotByEmail();
      } else {
        void submitAuth();
      }
    }
    if (e.key === 'Escape') hideModal();
  });
}

async function handleForgotByEmail(): Promise<void> {
  if (!overlay) return;
  const email = (overlay.querySelector('#forgotEmail') as HTMLInputElement)?.value.trim();
  const errEl = overlay.querySelector('#authError') as HTMLElement;
  const btn = overlay.querySelector('#forgotByEmailBtn') as HTMLButtonElement;
  errEl.textContent = '';
  if (!email) {
    errEl.textContent = t('err.enterEmail');
    return;
  }
  btn.disabled = true;
  try {
    await api.auth.forgotByEmail(email);
    errEl.className = 'forgot-success';
    errEl.textContent = t('ok.resetEmailSent');
  } catch (err) {
    errEl.className = 'modal-error';
    errEl.textContent = err instanceof ApiError ? err.message : t('err.generic');
    btn.disabled = false;
  }
}

async function submitAuth(): Promise<void> {
  if (!overlay) return;
  const mode = overlay.querySelector('.modal')?.getAttribute('data-mode') as Mode;
  const errEl = overlay.querySelector<HTMLElement>('#authError');
  const btn = overlay.querySelector<HTMLButtonElement>('#authSubmit');
  if (!errEl || !btn) return;
  errEl.textContent = '';
  btn.disabled = true;

  if (mode === 'reset') {
    const newPass = (overlay.querySelector('#newPassword') as HTMLInputElement)?.value;
    const confirmPass = (overlay.querySelector('#confirmPassword') as HTMLInputElement)?.value;
    if (newPass !== confirmPass) {
      errEl.textContent = t('err.passwordMismatch');
      btn.disabled = false;
      return;
    }
    try {
      await api.auth.resetPassword(_pendingResetToken, newPass);
      _pendingResetToken = '';
      showToast(t('ok.passwordReset'), 'ok');
      overlay!.innerHTML = buildModal('login');
    } catch (err) {
      errEl.textContent = err instanceof ApiError ? err.message : t('err.generic');
      btn.disabled = false;
    }
    return;
  }

  const email = (overlay.querySelector('#authEmail') as HTMLInputElement)?.value.trim();
  const pass = (overlay.querySelector('#authPass') as HTMLInputElement)?.value;
  const name = (overlay.querySelector('#authName') as HTMLInputElement)?.value.trim();

  try {
    const res =
      mode === 'login'
        ? await api.auth.login(email, pass)
        : await api.auth.register(email, pass, name || undefined);

    setSession(res.user);
    hideModal();
    updateAuthBtn();
    onAuthChange?.();

    const localRaw = localStorage.getItem('quiz:progress');
    const local = localRaw ? (JSON.parse(localRaw) as Record<string, boolean>) : null;
    if (local && Object.keys(local).length > 0) {
      const { data } = await api.progress.get();
      state.progress = Object.keys(data).length > 0 ? data : local;
      await api.progress.put(state.progress);
    } else {
      await loadProgress();
    }
    localStorage.removeItem('quiz:progress');

    if (mode === 'register') {
      showToast(t('ok.registered'), 'ok');
    }
  } catch (err) {
    errEl.textContent = err instanceof ApiError ? err.message : t('err.generic');
    if (mode === 'register') btn.disabled = false;
  } finally {
    if (mode === 'login') btn.disabled = false;
  }
}

export function showModal(mode: Mode = 'login'): void {
  if (overlay) overlay.innerHTML = buildModal(mode);
  overlay?.classList.add('show');
  setTimeout(() => (overlay?.querySelector('input') as HTMLInputElement)?.focus(), 50);
}

function hideModal(): void {
  overlay?.classList.remove('show');
}

export function updateAuthBtn(): void {
  const btn = document.getElementById('authBtn');
  if (!btn) return;
  if (auth.user) {
    const name = auth.user.displayName ?? auth.user.email.split('@')[0];
    const avatarId = Math.min(20, Math.max(1, auth.user.avatarId ?? 1));
    const pad = String(avatarId).padStart(2, '0');
    const streakEl = btn.querySelector('.auth-streak')?.cloneNode(true) ?? null;
    const avatar = document.createElement('img');
    avatar.className = 'auth-avatar';
    avatar.src = `/avatars/av${pad}.svg`;
    avatar.alt = '';
    const nameElement = document.createElement('span');
    nameElement.className = 'auth-name';
    nameElement.textContent = name;
    btn.replaceChildren(avatar, nameElement);
    if (streakEl) btn.appendChild(streakEl);
    btn.classList.add('logged-in');
    btn.title = t('topbar.viewProfile');

    if (auth.user.emailVerifiedAt === null) {
      let banner = document.getElementById('verifyBanner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'verifyBanner';
        banner.className = 'verify-banner';
        document.querySelector('.main')?.prepend(banner);
      }
      const email = document.createElement('strong');
      email.textContent = auth.user.email;
      const resend = document.createElement('button');
      resend.id = 'resendVerifyBtn';
      resend.textContent = t('verify.resend');
      const dismiss = document.createElement('button');
      dismiss.id = 'dismissVerifyBtn';
      dismiss.textContent = '✕';
      banner.replaceChildren(
        document.createTextNode(`${t('verify.message')} `),
        email,
        document.createTextNode('. '),
        resend,
        dismiss,
      );
      document.getElementById('resendVerifyBtn')?.addEventListener('click', () => {
        void api.auth
          .resendVerification()
          .then(() => showToast(t('ok.verifyEmailResent'), 'ok'))
          .catch((err: unknown) => {
            const msg = err instanceof ApiError ? err.message : t('err.generic');
            showToast(msg, 'error');
          });
      });
      document.getElementById('dismissVerifyBtn')?.addEventListener('click', () => {
        banner?.remove();
      });
    } else {
      document.getElementById('verifyBanner')?.remove();
    }
  } else {
    btn.innerHTML = t('topbar.login');
    btn.classList.remove('logged-in');
    btn.title = '';
    document.getElementById('verifyBanner')?.remove();
  }
}

export function bindAuthBtn(): void {
  document.getElementById('authBtn')?.addEventListener('click', () => {
    if (auth.user) {
      _openProfile?.();
    } else {
      showModal();
    }
  });
}

export async function doLogout(onLogout?: () => void): Promise<void> {
  try {
    await api.auth.logout();
  } finally {
    clearSession();
    state.progress = {};
    const localRaw = localStorage.getItem('quiz:progress');
    if (localRaw) state.progress = JSON.parse(localRaw) as Record<string, boolean>;
    onLogout?.();
    updateAuthBtn();
    render();
  }
}
