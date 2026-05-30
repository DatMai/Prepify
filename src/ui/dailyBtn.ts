import { openDaily, initDailyView } from '../daily/dailyView';
import { fetchDailyStatus } from '../api/streak';
import { isLoggedIn } from '../state/auth';

export function initDailyBtn(): void {
  initDailyView();

  const btn = document.getElementById('dailyBtn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    void openDaily();
  });

  if (isLoggedIn()) {
    void refreshDailyDot();
  }
}

export async function refreshDailyDot(): Promise<void> {
  if (!isLoggedIn()) return;
  try {
    const status = await fetchDailyStatus();
    const count = document.getElementById('dailyCount');
    const btn = document.getElementById('dailyBtn');
    if (count) count.textContent = String(status.currentStreak ?? 0);
    if (btn) btn.classList.toggle('done', status.completedToday);
  } catch {
    // non-critical
  }
}
