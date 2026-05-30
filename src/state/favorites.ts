import type { ProgressMap } from '../types/quiz';
import { state } from './progress';
import { isLoggedIn } from './auth';
import { api } from '../api/client';

const FAV_STORAGE_KEY = 'quiz:favorites';

export const favoritesState = {
  map: {} as ProgressMap,
  filterActive: false,
};

export function favKeyOf(topic: string, si: number, qi: number): string {
  return `fav:${topic}:${si}:${qi}`;
}

export function loadFavorites(): void {
  if (isLoggedIn()) {
    favoritesState.map = {};
    for (const k of Object.keys(state.progress)) {
      if (k.startsWith('fav:')) {
        favoritesState.map[k] = state.progress[k];
        delete state.progress[k];
      }
    }
  } else {
    try {
      const raw = localStorage.getItem(FAV_STORAGE_KEY);
      if (raw) favoritesState.map = JSON.parse(raw) as ProgressMap;
    } catch {
      /* ignore */
    }
  }
}

export async function toggleFavorite(topic: string, si: number, qi: number): Promise<void> {
  const favKey = favKeyOf(topic, si, qi);
  const newVal = !favoritesState.map[favKey];
  if (newVal) {
    favoritesState.map[favKey] = true;
  } else {
    delete favoritesState.map[favKey];
  }
  try {
    if (isLoggedIn()) {
      await api.progress.patch(favKey, newVal);
    } else {
      localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(favoritesState.map));
    }
  } catch {
    /* ignore */
  }
}
