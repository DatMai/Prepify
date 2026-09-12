import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { vi } from './vi';

/** Every `.ts` under `src` that is allowed to consume a translation key. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (full.endsWith('.ts') && !full.includes(`i18n${path.sep}`)) out.push(full);
  }
  return out;
}

const KEY_LINE = /^ {2}'([A-Za-z][\w.]*)':/gm;

function declaredKeys(text: string): string[] {
  return [...text.matchAll(KEY_LINE)].map((match) => match[1]!);
}

/** Keys whose tail is built at runtime, so a literal scan cannot see them. */
function isDynamic(key: string): boolean {
  return (
    key.startsWith('api.') || key.startsWith('journey.journal.') || key.startsWith('libAdmin.block')
  );
}

const raw = {
  vi: readFileSync(path.join(process.cwd(), 'src/i18n/vi.ts'), 'utf8'),
  en: readFileSync(path.join(process.cwd(), 'src/i18n/en.ts'), 'utf8'),
};

describe('i18n dictionaries', () => {
  it('expose exactly the same keys in both locales', () => {
    const viKeys = Object.keys(vi).sort();
    const enKeys = Object.keys(en).sort();

    expect(enKeys.filter((key) => !viKeys.includes(key))).toEqual([]);
    expect(viKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
  });

  it('have no empty translations', () => {
    const emptyVi = Object.entries(vi)
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    const emptyEn = Object.entries(en)
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);

    expect(emptyVi).toEqual([]);
    expect(emptyEn).toEqual([]);
  });

  // Read from the file text: after import a duplicate key has already collapsed,
  // so the parsed objects alone cannot reveal one.
  it('declare every key at most once per locale', () => {
    for (const [locale, text] of Object.entries(raw)) {
      const keys = declaredKeys(text);
      const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
      expect(duplicates, `${locale} declares a key twice`).toEqual([]);
    }
  });

  it('resolve every literal key used in the source', () => {
    const known = {
      vi: new Set(declaredKeys(raw.vi)),
      en: new Set(declaredKeys(raw.en)),
    };
    const missing: string[] = [];

    for (const file of sourceFiles(path.join(process.cwd(), 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\bt\(\s*'([^']+)'/g)) {
        const key = match[1]!;
        if (isDynamic(key)) continue;
        for (const locale of ['vi', 'en'] as const) {
          if (!known[locale].has(key)) missing.push(`${key} (${locale}) — ${file}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
