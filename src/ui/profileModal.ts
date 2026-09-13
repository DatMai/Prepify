import { api } from '../api/client';
import { auth } from '../state/auth';
import { state } from '../state/progress';
import { streakState } from '../state/streak';
import { updateAuthBtn, doLogout } from './authModal';
import { iconMarkup } from './icon';
import { t } from '../i18n';
import { X } from 'lucide';

let overlay: HTMLElement | null = null;
let onLogoutCb: (() => void) | null = null;
let selectedAvatarId = 1;

export function initProfileModal(onLogout: () => void): void {
  onLogoutCb = onLogout;
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay profile-overlay';
  overlay.innerHTML = buildProfileModal();
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === overlay) {
      closeProfile();
      return;
    }
    if (t.id === 'profileClose') {
      closeProfile();
      return;
    }
    if (t.id === 'profileSave') {
      void saveProfile();
      return;
    }
    if (t.id === 'profileLogout') {
      handleLogout();
      return;
    }

    const avOpt = t.closest('.av-opt') as HTMLElement | null;
    if (avOpt) {
      selectAvatar(parseInt(avOpt.dataset.id ?? '1', 10));
    }
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProfile();
  });
}

function buildProfileModal(): string {
  return `
    <div class="modal profile-modal">
      <button class="modal-close" id="profileClose" aria-label="${t('review.close')}">${iconMarkup(X)}</button>
      <h2>${t('profile.title')}</h2>

      <div class="profile-header">
        <img class="profile-av-main" id="profileAvMain" src="/avatars/av01.svg" alt="avatar" />
        <div class="profile-header-info">
          <div class="profile-display-name" id="profileDisplayName">—</div>
          <div class="profile-location" id="profileLocation"></div>
        </div>
      </div>

      <div class="profile-section-label">${t('profile.avatarLabel')}</div>
      <div class="av-grid">
        ${Array.from({ length: 20 }, (_, i) => {
          const n = i + 1;
          const pad = String(n).padStart(2, '0');
          return `<button class="av-opt" data-id="${n}"><img src="/avatars/av${pad}.svg" alt="av${pad}" /></button>`;
        }).join('')}
      </div>

      <div class="profile-section-label">${t('profile.infoLabel')}</div>
      <div class="field">
        <label>${t('profile.displayNameLabel')}</label>
        <input id="profileName" type="text" maxlength="50" placeholder="${t('profile.displayNamePlaceholder')}" />
      </div>
      <div class="field">
        <label>${t('profile.locationLabel')}</label>
        <input id="profileLoc" type="text" maxlength="100" placeholder="${t('profile.locationPlaceholder')}" />
      </div>

      <div class="modal-error" id="profileError"></div>

      <div class="profile-section-label">${t('profile.statsLabel')}</div>
      <div class="profile-stats">
        <div class="stat-chip">
          <div class="val" id="statLearned">0</div>
          <div class="lbl">${t('profile.learnedLabel')}</div>
        </div>
        <div class="stat-chip">
          <div class="val" id="statStreak">--</div>
          <div class="lbl">${t('profile.streakLabel')}</div>
        </div>
      </div>

      <div class="profile-actions">
        <button class="modal-submit profile-save" id="profileSave">${t('profile.save')}</button>
        <button class="profile-logout" id="profileLogout">${t('profile.logout')}</button>
      </div>
    </div>`;
}

function selectAvatar(id: number): void {
  selectedAvatarId = id;
  const pad = String(id).padStart(2, '0');
  (overlay!.querySelector('#profileAvMain') as HTMLImageElement).src = `/avatars/av${pad}.svg`;
  overlay!.querySelectorAll('.av-opt').forEach((btn) => {
    btn.classList.toggle('selected', parseInt((btn as HTMLElement).dataset.id ?? '0', 10) === id);
  });
}

export function openProfile(): void {
  if (!overlay || !auth.user) return;

  overlay.innerHTML = buildProfileModal();

  const user = auth.user;
  const avatarId = user.avatarId ?? 1;
  selectedAvatarId = avatarId;

  const pad = String(avatarId).padStart(2, '0');
  (overlay.querySelector('#profileAvMain') as HTMLImageElement).src = `/avatars/av${pad}.svg`;

  const displayName = user.displayName ?? user.email.split('@')[0];
  (overlay.querySelector('#profileDisplayName') as HTMLElement).textContent = displayName;
  (overlay.querySelector('#profileName') as HTMLInputElement).value = user.displayName ?? '';

  const locEl = overlay.querySelector('#profileLocation') as HTMLElement;
  locEl.textContent = user.location ?? '';
  (overlay.querySelector('#profileLoc') as HTMLInputElement).value = user.location ?? '';

  selectAvatar(avatarId);

  const learned = Object.values(state.progress).filter(Boolean).length;
  (overlay.querySelector('#statLearned') as HTMLElement).textContent = String(learned);
  (overlay.querySelector('#statStreak') as HTMLElement).textContent = streakState.loaded
    ? String(streakState.current)
    : '--';

  (overlay.querySelector('#profileError') as HTMLElement).textContent = '';

  overlay.classList.add('show');
}

export function closeProfile(): void {
  overlay?.classList.remove('show');
}

async function saveProfile(): Promise<void> {
  const nameInput = (overlay!.querySelector('#profileName') as HTMLInputElement).value.trim();
  const locInput = (overlay!.querySelector('#profileLoc') as HTMLInputElement).value.trim();
  const errEl = overlay!.querySelector('#profileError') as HTMLElement;
  const saveBtn = overlay!.querySelector('#profileSave') as HTMLButtonElement;

  errEl.textContent = '';
  saveBtn.disabled = true;

  try {
    const updated = await api.auth.updateProfile({
      displayName: nameInput || undefined,
      location: locInput || undefined,
      avatarId: selectedAvatarId,
    });

    if (auth.user) {
      auth.user.displayName = updated.displayName;
      auth.user.location = updated.location;
      auth.user.avatarId = updated.avatarId;
    }

    updateAuthBtn();
    closeProfile();
  } catch {
    errEl.textContent = t('profile.errGeneric');
  } finally {
    saveBtn.disabled = false;
  }
}

function handleLogout(): void {
  closeProfile();
  void doLogout(onLogoutCb ?? undefined);
}
