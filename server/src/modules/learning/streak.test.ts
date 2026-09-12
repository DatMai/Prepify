import { describe, expect, it } from 'vitest';
import { computeStreak, dateInTimeZone } from './streak';

describe('learning calendar', () => {
  it('uses the configured day boundary instead of UTC midnight', () => {
    const instant = new Date('2026-09-12T17:30:00.000Z');

    expect(dateInTimeZone(instant, 'Asia/Ho_Chi_Minh')).toBe('2026-09-13');
    expect(dateInTimeZone(instant, 'UTC')).toBe('2026-09-12');
  });

  it('computes current and longest runs from unique descending dates', () => {
    expect(
      computeStreak(['2026-09-12', '2026-09-12', '2026-09-11', '2026-09-09'], '2026-09-12'),
    ).toEqual({
      current: 2,
      longest: 2,
      studiedToday: true,
      lastActivityDate: '2026-09-12',
    });
  });

  it('keeps the current streak alive when the latest day was yesterday', () => {
    expect(computeStreak(['2026-09-11', '2026-09-10', '2026-09-08'], '2026-09-12')).toEqual({
      current: 2,
      longest: 2,
      studiedToday: false,
      lastActivityDate: '2026-09-11',
    });
  });

  it('resets the current streak after a gap longer than one day', () => {
    expect(computeStreak(['2026-09-08', '2026-09-07'], '2026-09-12')).toEqual({
      current: 0,
      longest: 2,
      studiedToday: false,
      lastActivityDate: '2026-09-08',
    });
  });

  it('handles an empty list', () => {
    expect(computeStreak([], '2026-09-12')).toEqual({
      current: 0,
      longest: 0,
      studiedToday: false,
      lastActivityDate: null,
    });
  });

  it('dedupes and sorts unsorted input', () => {
    expect(
      computeStreak(['2026-09-09', '2026-09-12', '2026-09-11', '2026-09-12'], '2026-09-12'),
    ).toEqual({
      current: 2,
      longest: 2,
      studiedToday: true,
      lastActivityDate: '2026-09-12',
    });
  });
});
