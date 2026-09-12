import type { DailyAnswer, DailyResponse } from '../daily/types';
import type { Lang } from '../i18n';
import { apiRequest } from './client';

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

export interface FlashcardActivityPayload {
  topicKey: string;
  mode: 'flashcard';
  total: number;
}

export interface SavedSession {
  id: string;
  completedAt: string;
}

export async function fetchStreak(): Promise<StreakInfo> {
  return apiRequest<StreakInfo>('/streak');
}

export async function fetchLeaderboard(limit = 20): Promise<LeaderboardResponse> {
  return apiRequest<LeaderboardResponse>(`/leaderboard?limit=${limit}`);
}

export async function saveQuizSession(payload: FlashcardActivityPayload): Promise<SavedSession> {
  return apiRequest<SavedSession>('/quiz-sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface DailyStatusResponse {
  completedToday: boolean;
  score?: number;
  total?: number;
  completedAt?: string;
  currentStreak?: number;
}

export async function fetchDailyQuestions(lang: Lang): Promise<DailyResponse> {
  return apiRequest<DailyResponse>(`/daily?lang=${lang}`);
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
  return apiRequest<DailyStatusResponse>('/daily/status');
}

export async function completeDailyChallenge(
  payload: DailyCompletePayload,
): Promise<DailyCompleteResult> {
  return apiRequest<DailyCompleteResult>('/daily/complete', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
