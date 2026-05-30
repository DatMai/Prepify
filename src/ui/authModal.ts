import { api, ApiError } from '../api/client';
import { setSession, clearSession, auth } from '../state/auth';
import { loadProgress, state } from '../state/progress';
import { render } from '../render/content';
import { showToast } from './toast';
import { checkStrength } from './passwordStrength';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

let _openProfile: (() => void) | null = null;
export function setProfileOpener(fn: () => void): void { _openProfile = fn; }

type Mode = 'login' | 'register' | 'forgot' | 'forgot-question' | 'reset';

let overlay: HTMLElement | null = null;
let onAuthChange: (() => void) | null = null;

let forgotEmail = '';
let forgotQuestion = '';
let _pendingResetToken = '';

export function setPendingResetToken(token: string): void {
  _pendingResetToken = token;
}

const SECURITY_QUESTIONS = [
  'Tên thú cưng đầu tiên của bạn?',
  'Tên trường tiểu học của bạn?',
  'Tên thành phố bạn sinh ra?',
  'Tên thầy/cô giáo yêu thích thời nhỏ?',
  'Tên nhân vật phim yêu thích thời nhỏ?',
  'Món ăn yêu thích của bạn?',
];

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
    const t = e.target as HTMLInputElement;
    const mode = overlay!.querySelector('.modal')?.getAttribute('data-mode') as Mode;
    if (t.id === 'authPass' && mode === 'register') {
      updateStrengthMeter(t.value);
    }
    if (t.id === 'newPassword' && mode === 'reset') {
      updateStrengthMeter(t.value);
    }
  });

  overlay.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'secQuestion') {
      const val = (t as HTMLSelectElement).value;
      const answerField = overlay!.querySelector('#secAnswerField') as HTMLElement | null;
      if (answerField) answerField.style.display = val ? 'block' : 'none';
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
      <span class="rule" data-pass="false">8+ ký tự</span>
      <span class="rule" data-pass="false">Chữ hoa</span>
      <span class="rule" data-pass="false">Chữ thường</span>
      <span class="rule" data-pass="false">Chữ số</span>
      <span class="rule" data-pass="false">Ký tự đặc biệt</span>
    </div>
  </div>`;
}

function buildModal(mode: Mode): string {
  const wrap = (inner: string) =>
    `<div class="modal" data-mode="${mode}"><button class="modal-close" id="modalClose">✕</button>${inner}</div>`;

  if (mode === 'forgot') {
    return wrap(`
      <h2>Quên mật khẩu</h2>
      <p>Nhập email tài khoản của bạn.</p>
      <div class="field"><label>Email</label><input id="forgotEmail" type="email" placeholder="you@example.com" autocomplete="email" /></div>
      <div class="modal-error" id="authError"></div>
      <div class="forgot-methods">
        <button id="forgotByEmailBtn">Gửi link về email</button>
        <button id="forgotByQuestionBtn">Dùng câu hỏi bí mật</button>
      </div>
      <div class="modal-switch"><a id="goLogin">← Quay lại đăng nhập</a></div>
    `);
  }

  if (mode === 'forgot-question') {
    return wrap(`
      <h2>Câu hỏi bí mật</h2>
      <div class="sq-display">${forgotQuestion}</div>
      <div class="field"><label>Câu trả lời</label><input id="sqAnswer" type="text" placeholder="Nhập câu trả lời..." autocomplete="off" /></div>
      <div class="modal-error" id="authError"></div>
      <button class="modal-submit" id="authSubmit">Xác nhận</button>
      <div class="modal-switch"><a id="goForgot">← Quay lại</a></div>
    `);
  }

  if (mode === 'reset') {
    return wrap(`
      <h2>Đặt lại mật khẩu</h2>
      <div class="field"><label>Mật khẩu mới</label><input id="newPassword" type="password" placeholder="••••••••" autocomplete="new-password" /></div>
      ${strengthMeterHtml()}
      <div class="field"><label>Xác nhận mật khẩu</label><input id="confirmPassword" type="password" placeholder="••••••••" autocomplete="new-password" /></div>
      <div class="modal-error" id="authError"></div>
      <button class="modal-submit" id="authSubmit" disabled>Đặt lại mật khẩu</button>
    `);
  }

  const isLogin = mode === 'login';
  return wrap(`
    <h2>${isLogin ? 'Đăng nhập' : 'Tạo tài khoản'}</h2>
    <p>${isLogin ? 'Sync progress trên mọi thiết bị.' : 'Đăng ký để lưu progress.'}</p>
    ${isLogin ? `
    <div class="oauth-btns">
      <a class="oauth-btn google" href="${API_BASE}/auth/google">
        <img src="/icons/google.svg" alt="" /> Tiếp tục với Google
      </a>
      <a class="oauth-btn facebook" href="${API_BASE}/auth/facebook">
        <img src="/icons/facebook.svg" alt="" /> Tiếp tục với Facebook
      </a>
    </div>
    <div class="or-divider"><span>hoặc</span></div>
    ` : ''}
    ${!isLogin ? `<div class="field"><label>Tên hiển thị (tuỳ chọn)</label><input id="authName" placeholder="VD: Minh Dev" autocomplete="name" /></div>` : ''}
    <div class="field"><label>Email</label><input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email" /></div>
    <div class="field"><label>Password</label><input id="authPass" type="password" placeholder="${isLogin ? '••••••' : 'Tối thiểu 8 ký tự'}" autocomplete="${isLogin ? 'current-password' : 'new-password'}" /></div>
    ${!isLogin ? `
    ${strengthMeterHtml()}
    <div class="security-q-section">
      <div class="sq-label">Câu hỏi bí mật <span>(tuỳ chọn)</span></div>
      <select id="secQuestion">
        <option value="">-- Chọn câu hỏi --</option>
        ${SECURITY_QUESTIONS.map(q => `<option value="${q}">${q}</option>`).join('')}
      </select>
      <div id="secAnswerField" style="display:none" class="field">
        <label>Câu trả lời</label>
        <input id="secAnswer" type="text" placeholder="Nhập câu trả lời..." autocomplete="off" />
      </div>
    </div>
    ` : ''}
    ${isLogin ? `<div class="forgot-link"><a id="goForgot">Quên mật khẩu?</a></div>` : ''}
    <div class="modal-error" id="authError"></div>
    <button class="modal-submit" id="authSubmit" ${!isLogin ? 'disabled' : ''}>${isLogin ? 'Đăng nhập' : 'Đăng ký'}</button>
    <div class="modal-switch">
      ${isLogin
        ? `Chưa có tài khoản? <a id="modeSwitch">Đăng ký</a>`
        : `Đã có tài khoản? <a id="modeSwitch">Đăng nhập</a>`}
    </div>
  `);
}

function updateStrengthMeter(password: string): void {
  const result = checkStrength(password);
  const fill = overlay!.querySelector('#strengthFill') as HTMLElement | null;
  const rules = overlay!.querySelectorAll('#strengthRules .rule');
  const btn = overlay!.querySelector('#authSubmit') as HTMLButtonElement | null;

  if (fill) fill.dataset.score = String(result.score);
  rules.forEach((el, i) => (el as HTMLElement).dataset.pass = String(result.passed[i]));
  if (btn) btn.disabled = result.score < 5;
}

function bindModal(): void {
  if (!overlay) return;

  overlay.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;

    if (t.id === 'modalClose') { hideModal(); return; }

    if (t.id === 'modeSwitch') {
      const current = overlay!.querySelector('.modal')?.getAttribute('data-mode') as Mode;
      overlay!.innerHTML = buildModal(current === 'login' ? 'register' : 'login');
      return;
    }

    if (t.id === 'authSubmit') {
      void submitAuth();
    }

    if (t.id === 'goForgot') {
      overlay!.innerHTML = buildModal('forgot');
      return;
    }

    if (t.id === 'goLogin') {
      overlay!.innerHTML = buildModal('login');
      return;
    }

    if (t.id === 'forgotByEmailBtn') {
      void handleForgotByEmail();
      return;
    }

    if (t.id === 'forgotByQuestionBtn') {
      void handleForgotByQuestion();
      return;
    }
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submitAuth();
    if (e.key === 'Escape') hideModal();
  });
}

async function handleForgotByEmail(): Promise<void> {
  if (!overlay) return;
  const email = (overlay.querySelector('#forgotEmail') as HTMLInputElement)?.value.trim();
  const errEl = overlay.querySelector('#authError') as HTMLElement;
  const btn = overlay.querySelector('#forgotByEmailBtn') as HTMLButtonElement;
  errEl.textContent = '';
  if (!email) { errEl.textContent = 'Vui lòng nhập email.'; return; }
  btn.disabled = true;
  try {
    await api.auth.forgotByEmail(email);
    errEl.className = 'forgot-success';
    errEl.textContent = 'Nếu email tồn tại, chúng tôi đã gửi link đặt lại.';
  } catch (err) {
    errEl.className = 'modal-error';
    errEl.textContent = err instanceof ApiError ? err.message : 'Có lỗi xảy ra, thử lại sau.';
    btn.disabled = false;
  }
}

async function handleForgotByQuestion(): Promise<void> {
  if (!overlay) return;
  const email = (overlay.querySelector('#forgotEmail') as HTMLInputElement)?.value.trim();
  const errEl = overlay.querySelector('#authError') as HTMLElement;
  const btn = overlay.querySelector('#forgotByQuestionBtn') as HTMLButtonElement;
  errEl.textContent = '';
  if (!email) { errEl.textContent = 'Vui lòng nhập email.'; return; }
  btn.disabled = true;
  try {
    const res = await api.auth.forgotGetQuestion(email);
    forgotEmail = email;
    forgotQuestion = res.question;
    overlay!.innerHTML = buildModal('forgot-question');
  } catch (err) {
    errEl.textContent = err instanceof ApiError ? err.message : 'Có lỗi xảy ra, thử lại sau.';
    btn.disabled = false;
  }
}

async function submitAuth(): Promise<void> {
  if (!overlay) return;
  const mode = overlay.querySelector('.modal')?.getAttribute('data-mode') as Mode;
  const errEl = overlay.querySelector('#authError') as HTMLElement;
  const btn = overlay.querySelector('#authSubmit') as HTMLButtonElement;
  errEl.textContent = '';
  btn.disabled = true;

  if (mode === 'forgot-question') {
    const answer = (overlay.querySelector('#sqAnswer') as HTMLInputElement)?.value.trim();
    if (!answer) { errEl.textContent = 'Vui lòng nhập câu trả lời.'; btn.disabled = false; return; }
    try {
      const res = await api.auth.forgotVerifyQuestion(forgotEmail, answer);
      _pendingResetToken = res.resetToken;
      overlay!.innerHTML = buildModal('reset');
    } catch (err) {
      errEl.textContent = err instanceof ApiError ? err.message : 'Có lỗi xảy ra, thử lại sau.';
      btn.disabled = false;
    }
    return;
  }

  if (mode === 'reset') {
    const newPass = (overlay.querySelector('#newPassword') as HTMLInputElement)?.value;
    const confirmPass = (overlay.querySelector('#confirmPassword') as HTMLInputElement)?.value;
    if (newPass !== confirmPass) {
      errEl.textContent = 'Mật khẩu xác nhận không khớp.';
      btn.disabled = false;
      return;
    }
    try {
      await api.auth.resetPassword(_pendingResetToken, newPass);
      _pendingResetToken = '';
      showToast('Mật khẩu đã được đặt lại!', 'ok');
      overlay!.innerHTML = buildModal('login');
    } catch (err) {
      errEl.textContent = err instanceof ApiError ? err.message : 'Có lỗi xảy ra, thử lại sau.';
      btn.disabled = false;
    }
    return;
  }

  const email = (overlay.querySelector('#authEmail') as HTMLInputElement)?.value.trim();
  const pass = (overlay.querySelector('#authPass') as HTMLInputElement)?.value;
  const name = (overlay.querySelector('#authName') as HTMLInputElement)?.value.trim();

  try {
    const res = mode === 'login'
      ? await api.auth.login(email, pass)
      : await api.auth.register(email, pass, name || undefined);

    setSession(res.token, res.user);
    const localRaw = localStorage.getItem('quiz:progress');
    const local = localRaw ? JSON.parse(localRaw) as Record<string, boolean> : null;
    if (local && Object.keys(local).length > 0) {
      const { data } = await api.progress.get();
      state.progress = Object.keys(data).length > 0 ? data : local;
      await api.progress.put(state.progress);
    } else {
      await loadProgress();
    }
    localStorage.removeItem('quiz:progress');

    if (mode === 'register') {
      const secQ = (overlay.querySelector('#secQuestion') as HTMLSelectElement)?.value;
      const secA = (overlay.querySelector('#secAnswer') as HTMLInputElement)?.value.trim();
      if (secQ && secA) {
        await api.auth.setSecurityQuestion(secQ, secA).catch(() => {});
      }
      showToast('Đăng ký thành công! Kiểm tra email để xác minh tài khoản.', 'ok');
    }

    hideModal();
    updateAuthBtn();
    onAuthChange?.();
  } catch (err) {
    errEl.textContent = err instanceof ApiError ? err.message : 'Có lỗi xảy ra, thử lại sau.';
    if (mode === 'register') btn.disabled = false;
  } finally {
    if (mode === 'login') btn.disabled = false;
  }
}

export function showModal(mode: Mode = 'login'): void {
  if (overlay && mode !== 'login') overlay.innerHTML = buildModal(mode);
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
    const avatarId = auth.user.avatarId ?? 1;
    const pad = String(avatarId).padStart(2, '0');
    // Preserve existing .auth-streak span — renderStreakBadge manages it separately
    const streakEl = btn.querySelector('.auth-streak')?.cloneNode(true) ?? null;
    btn.innerHTML = `<img class="auth-avatar" src="/avatars/av${pad}.svg" alt="" /><span class="auth-name">${name}</span>`;
    if (streakEl) btn.appendChild(streakEl);
    btn.classList.add('logged-in');
    btn.title = 'Xem profile';

    // Verification banner
    if (auth.user.emailVerifiedAt === null) {
      let banner = document.getElementById('verifyBanner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'verifyBanner';
        banner.className = 'verify-banner';
        document.querySelector('.main')?.prepend(banner);
      }
      banner.innerHTML = `
        Vui lòng xác minh email <strong>${auth.user.email}</strong>.
        <button id="resendVerifyBtn">Gửi lại</button>
        <button id="dismissVerifyBtn">✕</button>
      `;
      document.getElementById('resendVerifyBtn')?.addEventListener('click', () => {
        void api.auth.resendVerification()
          .then(() => showToast('Đã gửi lại email xác minh.', 'ok'))
          .catch((err: unknown) => {
            const msg = err instanceof ApiError ? err.message : 'Có lỗi xảy ra.';
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
    btn.innerHTML = 'Đăng nhập';
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

export function doLogout(onLogout?: () => void): void {
  clearSession();
  state.progress = {};
  const localRaw = localStorage.getItem('quiz:progress');
  if (localRaw) state.progress = JSON.parse(localRaw) as Record<string, boolean>;
  onLogout?.();
  updateAuthBtn();
  render();
}
