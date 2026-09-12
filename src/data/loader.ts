import { api } from '../api/client';
import type { Topic, TopicIndexEntry } from '../types/quiz';
import { getLang, type Lang } from '../i18n';

export const TOPIC_INDEX: TopicIndexEntry[] = [];
export const ORDER: string[] = [];
export const DATA: Record<string, Topic> = {};

let loadedLang: Lang | null = null;

export async function loadLibrary(lang: Lang = getLang()): Promise<void> {
  if (loadedLang === lang) return;
  const index = await api.library.index(lang);
  const topics = await Promise.all(
    index.map(async (entry) => [entry.key, await api.library.topic(entry.key, lang)] as const),
  );

  TOPIC_INDEX.splice(0, TOPIC_INDEX.length, ...index);
  ORDER.splice(0, ORDER.length, ...index.map((entry) => entry.key));
  Object.keys(DATA).forEach((key) => delete DATA[key]);
  topics.forEach(([key, topic]) => {
    DATA[key] = topic;
  });
  loadedLang = lang;
}

export function clearLibrary(): void {
  TOPIC_INDEX.splice(0);
  ORDER.splice(0);
  Object.keys(DATA).forEach((key) => delete DATA[key]);
  loadedLang = null;
}
