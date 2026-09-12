import { describe, expect, it } from 'vitest';
import { createDailyChallengeCodec } from './dailyChallenge';

const secret = '0123456789abcdef0123456789abcdef';

describe('daily challenge integrity', () => {
  it('keeps answer keys opaque and scores submitted answers on the server', () => {
    const codec = createDailyChallengeCodec(secret, () => Buffer.alloc(12, 7));
    const token = codec.seal({
      userId: 'user-1',
      date: '2026-09-12',
      answers: [
        { id: 'q1', type: 'mcq', correctIdx: 2 },
        { id: 'q2', type: 'fib', blanks: ['hash table'] },
      ],
    });

    expect(token).not.toContain('hash table');
    expect(
      codec.grade(token, 'user-1', '2026-09-12', [
        { questionId: 'q1', selectedIdx: 2 },
        { questionId: 'q2', blanks: ['Hash Table'] },
      ]),
    ).toEqual({ score: 2, total: 2 });
  });

  it('rejects tampering and a challenge issued for another user', () => {
    const codec = createDailyChallengeCodec(secret, () => Buffer.alloc(12, 3));
    const token = codec.seal({
      userId: 'user-1',
      date: '2026-09-12',
      answers: [{ id: 'q1', type: 'mcq', correctIdx: 0 }],
    });

    expect(() => codec.grade(`${token}x`, 'user-1', '2026-09-12', [])).toThrow(/Invalid challenge/);
    expect(() => codec.grade(token, 'user-2', '2026-09-12', [])).toThrow(/Invalid challenge/);
  });
});
