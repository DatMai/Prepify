import type { DailyAnswer, DailyResponse } from '../daily/types';
import type { Lang } from '../i18n';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' };
}

const authenticated = { credentials: 'include' as const };

export interface StreakInfo {
  current: number;
  longest: number;
  studiedToday: boolean;
  lastActivityDate: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  learnedCount: number;
  streakDays: number;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  myRank: number | null;
}

export interface QuizSessionPayload {
  topicKey: string;
  mode: 'flashcard' | 'mcq';
  total: number;
  score: number;
}

export interface SavedSession {
  id: string;
  completedAt: string;
}

export async function fetchStreak(): Promise<StreakInfo> {
  const res = await fetch(`${BASE}/streak`, { ...authenticated, headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch streak');
  return res.json() as Promise<StreakInfo>;
}

export async function fetchLeaderboard(limit = 20): Promise<LeaderboardResponse> {
  const res = await fetch(`${BASE}/leaderboard?limit=${limit}`, {
    ...authenticated,
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch leaderboard');
  return res.json() as Promise<LeaderboardResponse>;
}

export async function saveQuizSession(payload: QuizSessionPayload): Promise<SavedSession> {
  const res = await fetch(`${BASE}/quiz-sessions`, {
    method: 'POST',
    ...authenticated,
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to save quiz session');
  return res.json() as Promise<SavedSession>;
}

export interface DailyStatusResponse {
  completedToday: boolean;
  score?: number;
  total?: number;
  completedAt?: string;
  currentStreak?: number;
}

export async function fetchDailyQuestions(lang: Lang): Promise<DailyResponse> {
  const res = await fetch(`${BASE}/daily?lang=${lang}`, {
    ...authenticated,
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch daily questions');
  return res.json() as Promise<DailyResponse>;
}

export interface DailyCompletePayload {
  date: string;
  challenge: string;
  answers: DailyAnswer[];
}

export interface DailyCompleteResult {
  ok: boolean;
  score: number;
  total: number;
  streak: { current: number; longest: number };
}

export async function fetchDailyStatus(): Promise<DailyStatusResponse> {
  const res = await fetch(`${BASE}/daily/status`, {
    ...authenticated,
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch daily status');
  return res.json() as Promise<DailyStatusResponse>;
}

export async function completeDailyChallenge(
  payload: DailyCompletePayload,
): Promise<DailyCompleteResult> {
  const res = await fetch(`${BASE}/daily/complete`, {
    method: 'POST',
    ...authenticated,
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = new Error('Failed to complete daily') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<DailyCompleteResult>;
}
