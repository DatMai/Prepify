import { describe, expect, it, vi } from 'vitest';
import { createReviewRepository } from './reviewRepository';

const row = {
  topic: 'javascript',
  section_idx: 0,
  question_idx: 1,
  interval_days: 3,
  ease: 2.5,
  review_count: 1,
  due_at: '2026-09-15T00:00:00.000Z',
};

describe('createReviewRepository', () => {
  it('upserts and maps camelCase columns', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const repo = createReviewRepository({ query });

    const result = await repo.upsert({
      userId: 'u1',
      topic: 'javascript',
      sectionIdx: 0,
      questionIdx: 1,
      intervalDays: 3,
      ease: 2.5,
      reviewCount: 1,
      dueAt: '2026-09-15T00:00:00.000Z',
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), expect.any(Array));
    expect(result).toMatchObject({ topic: 'javascript', sectionIdx: 0, intervalDays: 3 });
  });

  it('lists due schedules for a user', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const repo = createReviewRepository({ query });

    const items = await repo.listDue('u1', '2026-09-15T00:00:00.000Z');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE user_id = $1 AND due_at <= $2'),
      ['u1', '2026-09-15T00:00:00.000Z'],
    );
    expect(items[0]).toMatchObject({ topic: 'javascript', questionIdx: 1 });
  });

  it('finds a single schedule row', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const repo = createReviewRepository({ query });

    const found = await repo.find('u1', 'javascript', 0, 1);

    expect(found).toMatchObject({ topic: 'javascript', sectionIdx: 0, questionIdx: 1 });
    expect(query.mock.calls[0]?.[1]).toEqual(['u1', 'javascript', 0, 1]);
  });
});
