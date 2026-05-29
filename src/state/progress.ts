import type { AppState, ProgressMap } from '../types/quiz';
import { api } from '../api/client';
import { isLoggedIn } from './auth';

const STORAGE_KEY = 'quiz:progress';

export const state: AppState = {
  topic: 'javascript',
  progress: {},
  open: {},
};

export function keyOf(topic: string, sIdx: number, qIdx: number): string {
  return `${topic}:${sIdx}:${qIdx}`;
}

export async function loadProgress(): Promise<void> {
  try {
    if (isLoggedIn()) {
      const { data } = await api.progress.get();
      state.progress = data;
      return;
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state.progress = JSON.parse(raw) as ProgressMap;
  } catch {
    /* ignore */
  }
}

export async function saveProgress(): Promise<void> {
  try {
    if (isLoggedIn()) {
      await api.progress.put(state.progress);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
  } catch {
    /* ignore */
  }
}

// Optimistic patch — update single key via PATCH (faster than full PUT)
export async function toggleProgress(key: string, value: boolean): Promise<void> {
  state.progress[key] = value;
  try {
    if (isLoggedIn()) {
      await api.progress.patch(key, value);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
  } catch {
    /* ignore */
  }
}
