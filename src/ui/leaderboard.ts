import { fetchLeaderboard, type LeaderboardEntry } from '../api/streak';
import { isLoggedIn } from '../state/auth';

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
  overlay!.classList.add('show');
  setBody('<div class="lb-loading">Đang tải…</div>');

  try {
    const { entries, myRank } = await fetchLeaderboard(20);
    setBody(buildTable(entries, myRank));
  } catch {
    setBody('<div class="lb-empty">Không thể tải dữ liệu. Thử lại sau.</div>');
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
      <h2>🏆 Leaderboard</h2>
      <div id="lbBody"><div class="lb-loading">Đang tải…</div></div>
      ${!isLoggedIn() ? `<p class="lb-guest-cta">Đăng nhập để góp mặt vào bảng xếp hạng!</p>` : ''}
    </div>`;
}

function buildTable(entries: LeaderboardEntry[], myRank: number | null): string {
  if (entries.length === 0) {
    return '<div class="lb-empty">Chưa có dữ liệu. Hãy là người đầu tiên!</div>';
  }

  const rows = entries.map((e) => {
    const isMe = myRank !== null && e.rank === myRank;
    const medalMap: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const rankLabel = medalMap[e.rank] ?? `#${e.rank}`;

    return `
      <tr class="lb-row${isMe ? ' lb-me' : ''}">
        <td class="lb-rank">${rankLabel}</td>
        <td class="lb-name">${isMe ? '▶ ' : ''}${escName(e.displayName)}</td>
        <td class="lb-learned">${e.learnedCount}</td>
        <td class="lb-streak">${e.streakDays > 0 ? `🔥 ${e.streakDays}` : '—'}</td>
      </tr>`;
  }).join('');

  return `
    <table class="lb-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Tên</th>
          <th>Đã học</th>
          <th>Streak</th>
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
