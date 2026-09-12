import { api } from '../api/client';
import { applyGrade, type ReviewQuality, type ReviewSchedule } from '../review/scheduler';
import { isLoggedIn } from './auth';

const STORAGE_KEY = 'quiz:review';

export interface ReviewState {
  schedules: Record<string, ReviewSchedule>;
}

export const reviewState: ReviewState = { schedules: {} };

export function keyOfReview(topic: string, sIdx: number, qIdx: number): string {
  return `${topic}:${sIdx}:${qIdx}`;
}

function localDateIso(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysIso(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  const next = new Date(year, month - 1, day + days);
  return localDateIso(next);
}

export async function loadReviewState(): Promise<void> {
  try {
    if (isLoggedIn()) {
      const { items } = await api.review.due();
      reviewState.schedules = {};
      for (const item of items) {
        reviewState.schedules[keyOfReview(item.topic, item.sectionIdx, item.questionIdx)] = item;
      }
      return;
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) reviewState.schedules = JSON.parse(raw) as ReviewState['schedules'];
  } catch {
    /* ignore */
  }
}

export function dueCount(): number {
  const nowMs = Date.now();
  return Object.values(reviewState.schedules).filter((s) => Date.parse(s.dueAt) <= nowMs).length;
}

export async function gradeQuestion(
  topic: string,
  sectionIdx: number,
  questionIdx: number,
  quality: ReviewQuality,
): Promise<ReviewSchedule | null> {
  const key = keyOfReview(topic, sectionIdx, questionIdx);
  try {
    if (isLoggedIn()) {
      const { schedule } = await api.review.grade(topic, sectionIdx, questionIdx, quality);
      reviewState.schedules[key] = schedule;
      return schedule;
    }
    const current = reviewState.schedules[key] ?? null;
    const placeholder = applyGrade(
      current ? { ...current } : null,
      quality,
      new Date().toISOString(),
    );
    const next: ReviewSchedule = {
      ...placeholder,
      topic,
      sectionIdx,
      questionIdx,
      dueAt: `${addDaysIso(localDateIso(), placeholder.intervalDays)}T00:00:00.000Z`,
    };
    reviewState.schedules[key] = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reviewState.schedules));
    return next;
  } catch {
    return null;
  }
}
