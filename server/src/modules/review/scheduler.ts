export type ReviewQuality = 'again' | 'hard' | 'good';

export interface ReviewSchedule {
  topic: string;
  sectionIdx: number;
  questionIdx: number;
  intervalDays: number;
  ease: number;
  reviewCount: number;
  dueAt: string;
}

const MAX_INTERVAL = 180;
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;

const EASE_DELTA: Record<ReviewQuality, number> = {
  again: -0.2,
  hard: -0.15,
  good: 0.05,
};

export function applyGrade(
  current: ReviewSchedule | null,
  quality: ReviewQuality,
  dueAtIso: string,
): ReviewSchedule {
  const prev = current ?? {
    topic: '',
    sectionIdx: 0,
    questionIdx: 0,
    intervalDays: 1,
    ease: 2.5,
    reviewCount: 0,
    dueAt: dueAtIso,
  };
  const isNew = prev.reviewCount === 0;
  let interval: number;
  if (quality === 'again') interval = 1;
  else if (isNew) interval = quality === 'hard' ? 3 : 7;
  else interval = Math.round(prev.intervalDays * (quality === 'hard' ? 1.5 : prev.ease));
  interval = Math.min(MAX_INTERVAL, Math.max(1, interval));

  const ease = Math.min(MAX_EASE, Math.max(MIN_EASE, prev.ease + EASE_DELTA[quality]));

  return {
    topic: prev.topic,
    sectionIdx: prev.sectionIdx,
    questionIdx: prev.questionIdx,
    intervalDays: interval,
    ease,
    reviewCount: prev.reviewCount + 1,
    dueAt: dueAtIso,
  };
}
