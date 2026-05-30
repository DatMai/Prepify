import { fetchStreak, type StreakInfo } from '../api/streak';
import { renderStreakBadge } from '../ui/streakBadge';

export interface StreakState extends StreakInfo {
  loaded: boolean;
}

export const streakState: StreakState = {
  current: 0,
  longest: 0,
  studiedToday: false,
  lastActivityDate: null,
  loaded: false,
};

export async function loadStreak(): Promise<void> {
  try {
    const info = await fetchStreak();
    Object.assign(streakState, info, { loaded: true });
    renderStreakBadge(streakState.current);
  } catch {
    // streak is non-critical — ignore errors silently
  }
}

export function resetStreak(): void {
  Object.assign(streakState, { current: 0, longest: 0, studiedToday: false, lastActivityDate: null, loaded: false });
  renderStreakBadge(0);
}

// Called optimistically when progress PATCH fires (user is logged in)
export function markStudiedToday(): void {
  if (streakState.studiedToday) return;
  const wasZero = streakState.current === 0;
  streakState.studiedToday = true;
  streakState.current = wasZero ? 1 : streakState.current + 1;
  renderStreakBadge(streakState.current);
}
