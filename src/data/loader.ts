import { api } from '../api/client';
import type { Topic, TopicIndexEntry } from '../types/quiz';
import { getLang, type Lang } from '../i18n';

export const TOPIC_INDEX: TopicIndexEntry[] = [];
export const ORDER: string[] = [];
export const DATA: Record<string, Topic> = {};

let loadedLang: Lang | null = null;
const topicLoads: Record<string, Promise<Topic>> = {};

export async function loadLibrary(lang: Lang = getLang()): Promise<void> {
  if (loadedLang === lang) return;
  const index = await api.library.index(lang);
  TOPIC_INDEX.splice(0, TOPIC_INDEX.length, ...index);
  ORDER.splice(0, ORDER.length, ...index.map((entry) => entry.key));
  Object.keys(DATA).forEach((key) => delete DATA[key]);
  Object.keys(topicLoads).forEach((key) => delete topicLoads[key]);
  loadedLang = lang;
}

export async function loadTopic(key: string, lang: Lang = getLang()): Promise<Topic> {
  if (loadedLang !== lang) await loadLibrary(lang);
  if (DATA[key]) return DATA[key];

  const pending =
    topicLoads[key] ??
    (topicLoads[key] = api.library.topic(key, lang).then((topic) => {
      if (loadedLang === lang) DATA[key] = topic;
      return topic;
    }));
  return pending;
}

export function clearLibrary(): void {
  TOPIC_INDEX.splice(0);
  ORDER.splice(0);
  Object.keys(DATA).forEach((key) => delete DATA[key]);
  Object.keys(topicLoads).forEach((key) => delete topicLoads[key]);
  loadedLang = null;
}
