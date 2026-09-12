import { vi } from './vi';
import { en } from './en';

export type Lang = 'vi' | 'en';

const DICT: Record<Lang, Record<string, string>> = { vi, en };
const STORAGE_KEY = 'quiz:lang';

let currentLang: Lang = (localStorage.getItem(STORAGE_KEY) as Lang | null) ?? 'vi';

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let str = DICT[currentLang][key] ?? DICT.vi[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}
