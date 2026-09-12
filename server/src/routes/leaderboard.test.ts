import { describe, expect, it } from 'vitest';
import { resolveMyRank } from './leaderboard';

const rows = [
  {
    user_id: 'user-1',
    display_name: 'One',
    email: 'one@example.com',
    learned_count: 10,
    streak_days: 3,
  },
  {
    user_id: 'user-2',
    display_name: 'Two',
    email: 'two@example.com',
    learned_count: 5,
    streak_days: 2,
  },
];

describe('leaderboard identity', () => {
  it('resolves rank from the server-authenticated user id', () => {
    expect(resolveMyRank('user-2', rows)).toBe(2);
    expect(resolveMyRank(undefined, rows)).toBeNull();
    expect(resolveMyRank('missing', rows)).toBeNull();
  });
});
