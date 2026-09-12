import { describe, expect, it } from 'vitest';
import { en } from './en';
import { vi } from './vi';

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
});
