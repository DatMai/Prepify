import { api, ApiError } from '../api/client';
import { setSession, clearSession, auth } from '../state/auth';
import { loadProgress, state } from '../state/progress';
import { render } from '../render/content';

type Mode = 'login' | 'register';

let overlay: HTMLElement | null = null;
let onAuthChange: (() => void) | null = null;

export function initAuthModal(onChange: () => void): void {
  onAuthChange = onChange;
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = buildModal('login');
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideModal();
  });

  bindModal();
  updateAuthBtn();
}

function buildModal(mode: Mode): string {
  const isLogin = mode === 'login';
  return `
    <div class="modal" data-mode="${mode}">
      <button class="modal-close" id="modalClose">✕</button>
      <h2>${isLogin ? 'Đăng nhập' : 'Tạo tài khoản'}</h2>
      <p>${isLogin ? 'Sync progress trên mọi thiết bị.' : 'Đăng ký để lưu progress.'}</p>
      ${!isLogin ? `<div class="field"><label>Tên hiển thị (tuỳ chọn)</label><input id="authName" placeholder="VD: Minh Dev" autocomplete="name" /></div>` : ''}
      <div class="field"><label>Email</label><input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email" /></div>
      <div class="field"><label>Password</label><input id="authPass" type="password" placeholder="••••••" autocomplete="${isLogin ? 'current-password' : 'new-password'}" /></div>
      <div class="modal-error" id="authError"></div>
      <button class="modal-submit" id="authSubmit">${isLogin ? 'Đăng nhập' : 'Đăng ký'}</button>
      <div class="modal-switch">
        ${isLogin
          ? `Chưa có tài khoản? <a id="modeSwitch">Đăng ký</a>`
          : `Đã có tài khoản? <a id="modeSwitch">Đăng nhập</a>`}
      </div>
    </div>`;
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
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submitAuth();
    if (e.key === 'Escape') hideModal();
  });
}

async function submitAuth(): Promise<void> {
  if (!overlay) return;
  const mode = overlay.querySelector('.modal')?.getAttribute('data-mode') as Mode;
  const email = (overlay.querySelector('#authEmail') as HTMLInputElement)?.value.trim();
  const pass = (overlay.querySelector('#authPass') as HTMLInputElement)?.value;
  const name = (overlay.querySelector('#authName') as HTMLInputElement)?.value.trim();
  const errEl = overlay.querySelector('#authError') as HTMLElement;
  const btn = overlay.querySelector('#authSubmit') as HTMLButtonElement;

  errEl.textContent = '';
  btn.disabled = true;

  try {
    const res = mode === 'login'
      ? await api.auth.login(email, pass)
      : await api.auth.register(email, pass, name || undefined);

    setSession(res.token, res.user);
    const localRaw = localStorage.getItem('quiz:progress');
    const local = localRaw ? JSON.parse(localRaw) as Record<string, boolean> : null;
    if (local && Object.keys(local).length > 0) {
      // server progress takes priority; fall back to local only if server is empty
      const { data } = await api.progress.get();
      state.progress = Object.keys(data).length > 0 ? data : local;
      await api.progress.put(state.progress);
    } else {
      await loadProgress();
    }
    localStorage.removeItem('quiz:progress');

    hideModal();
    updateAuthBtn();
    onAuthChange?.();
  } catch (err) {
    errEl.textContent = err instanceof ApiError ? err.message : 'Có lỗi xảy ra, thử lại sau.';
  } finally {
    btn.disabled = false;
  }
}

export function showModal(): void {
  overlay?.classList.add('show');
  setTimeout(() => (overlay?.querySelector('#authEmail') as HTMLInputElement)?.focus(), 50);
}

function hideModal(): void {
  overlay?.classList.remove('show');
}

export function updateAuthBtn(): void {
  const btn = document.getElementById('authBtn');
  if (!btn) return;
  if (auth.user) {
    btn.textContent = `👤 ${auth.user.displayName ?? auth.user.email.split('@')[0]}`;
    btn.classList.add('logged-in');
    btn.title = 'Click để đăng xuất';
  } else {
    btn.textContent = '🔑 Đăng nhập';
    btn.classList.remove('logged-in');
    btn.title = '';
  }
}

export function bindAuthBtn(): void {
  document.getElementById('authBtn')?.addEventListener('click', () => {
    if (auth.user) {
      clearSession();
      state.progress = {};
      const localRaw = localStorage.getItem('quiz:progress');
      if (localRaw) state.progress = JSON.parse(localRaw) as Record<string, boolean>;
      updateAuthBtn();
      render();
    } else {
      showModal();
    }
  });
}
