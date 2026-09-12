const MS_PER_DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface StreakInfo {
  current: number;
  longest: number;
  studiedToday: boolean;
  lastActivityDate: string | null;
}

/**
 * Returns the calendar date (YYYY-MM-DD) for `now` in the given IANA
 * time zone. This is the "study day" boundary: it flips at local
 * midnight instead of UTC midnight.
 */
export function dateInTimeZone(now = new Date(), timeZone = 'Asia/Ho_Chi_Minh'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function toDayIndex(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/**
 * Computes streak info from a list of study dates. The list may contain
 * duplicates and may be unsorted; the function dedupes and sorts
 * descending before counting runs.
 */
export function computeStreak(dates: string[], today: string): StreakInfo {
  const unique = [...new Set(dates.filter((date) => DATE_RE.test(date)))];
  if (unique.length === 0) {
    return { current: 0, longest: 0, studiedToday: false, lastActivityDate: null };
  }

  const byDay = unique
    .map((date) => ({ date, index: toDayIndex(date) }))
    .sort((a, b) => b.index - a.index);

  const todayIndex = toDayIndex(today);
  const latest = byDay[0];

  // Current streak is only "alive" if the latest activity is today or
  // yesterday; otherwise it has already been broken.
  let current = 0;
  if (latest.index === todayIndex || latest.index === todayIndex - 1) {
    let expected = latest.index;
    for (const entry of byDay) {
      if (entry.index !== expected) break;
      current++;
      expected--;
    }
  }

  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const entry of byDay) {
    run = previous !== null && previous - entry.index === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = entry.index;
  }

  return {
    current,
    longest,
    studiedToday: latest.index === todayIndex,
    lastActivityDate: latest.date,
  };
}
