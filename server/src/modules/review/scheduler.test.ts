import { describe, expect, it } from 'vitest';
import { applyGrade, type ReviewSchedule } from './scheduler';

const base: ReviewSchedule = {
  topic: 'javascript',
  sectionIdx: 0,
  questionIdx: 0,
  intervalDays: 1,
  ease: 2.5,
  reviewCount: 0,
  dueAt: '2026-09-12T10:00:00.000Z',
};

describe('applyGrade', () => {
  it('schedules a new card with again/hard/good', () => {
    expect(applyGrade(base, 'again', '2026-09-13T00:00:00.000Z')).toMatchObject({
      intervalDays: 1,
      ease: 2.3,
      reviewCount: 1,
      dueAt: '2026-09-13T00:00:00.000Z',
    });
    expect(applyGrade(base, 'hard', '2026-09-16T00:00:00.000Z')).toMatchObject({
      intervalDays: 3,
      ease: 2.35,
      reviewCount: 1,
    });
    expect(applyGrade(base, 'good', '2026-09-20T00:00:00.000Z')).toMatchObject({
      intervalDays: 7,
      ease: 2.55,
      reviewCount: 1,
    });
  });

  it('grows a known card with the ease factor and caps the interval at 180 days', () => {
    const known = { ...base, intervalDays: 10, ease: 2.5, reviewCount: 2 };
    expect(applyGrade(known, 'good', '2026-10-05T00:00:00.000Z')).toMatchObject({
      intervalDays: 25,
      reviewCount: 3,
    });
    const huge = { ...base, intervalDays: 150, ease: 2.0, reviewCount: 2 };
    expect(applyGrade(huge, 'good', 'x')).toMatchObject({ intervalDays: 180 });
  });

  it('resets to one day on again and clamps ease at 1.3', () => {
    const known = { ...base, intervalDays: 40, ease: 1.4, reviewCount: 5 };
    expect(applyGrade(known, 'again', 'x')).toMatchObject({
      intervalDays: 1,
      ease: 1.3,
      reviewCount: 6,
    });
  });
});
