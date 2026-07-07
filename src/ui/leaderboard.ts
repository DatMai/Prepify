import { fetchLeaderboard, type LeaderboardEntry } from '../api/streak';
import { isLoggedIn } from '../state/auth';
import { t } from '../i18n';

let overlay: HTMLElement | null = null;

export function initLeaderboardModal(): void {
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'leaderboardOverlay';
  overlay.innerHTML = buildShell();
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeLeaderboard();
  });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLeaderboard();
  });
  overlay.querySelector('#lbClose')?.addEventListener('click', closeLeaderboard);
}

export async function openLeaderboard(): Promise<void> {
  if (!overlay) initLeaderboardModal();
  // Rebuild shell to pick up language changes
  overlay!.innerHTML = buildShell();
  overlay!.querySelector('#lbClose')?.addEventListener('click', closeLeaderboard);
  overlay!.classList.add('show');
  setBody(`<div class="lb-loading">${t('lb.loading')}</div>`);

  try {
    const { entries, myRank } = await fetchLeaderboard(20);
    setBody(buildTable(entries, myRank));
  } catch {
    setBody(`<div class="lb-empty">${t('lb.loadError')}</div>`);
  }
}

function closeLeaderboard(): void {
  overlay?.classList.remove('show');
}

function setBody(html: string): void {
  const body = overlay?.querySelector('#lbBody');
  if (body) body.innerHTML = html;
}

function buildShell(): string {
  return `
    <div class="modal lb-modal">
      <button class="modal-close" id="lbClose">✕</button>
      <h2>${t('lb.title')}</h2>
      <div id="lbBody"><div class="lb-loading">${t('lb.loading')}</div></div>
      ${!isLoggedIn() ? `<p class="lb-guest-cta">${t('lb.loginCta')}</p>` : ''}
    </div>`;
}

function buildTable(entries: LeaderboardEntry[], myRank: number | null): string {
  if (entries.length === 0) {
    return `<div class="lb-empty">${t('lb.noData')}</div>`;
  }

  const rows = entries.map((e) => {
    const isMe = myRank !== null && e.rank === myRank;
    const medalMap: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const rankLabel = medalMap[e.rank] ?? `#${e.rank}`;

    return `
      <tr class="lb-row${isMe ? ' lb-me' : ''}">
        <td class="lb-rank">${rankLabel}</td>
        <td class="lb-name">${isMe ? t('lb.mePrefix') : ''}${escName(e.displayName)}</td>
        <td class="lb-learned">${e.learnedCount}</td>
        <td class="lb-streak">${e.streakDays > 0 ? `🔥 ${e.streakDays}` : '—'}</td>
      </tr>`;
  }).join('');

  return `
    <table class="lb-table">
      <thead>
        <tr>
          <th>#</th>
          <th>${t('lb.colName')}</th>
          <th>${t('lb.colLearned')}</th>
          <th>${t('lb.colStreak')}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function escName(name: string): string {
  return name
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
