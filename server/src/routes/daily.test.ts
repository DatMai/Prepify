import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyEntryRecord, LibraryRepository } from '../modules/library/libraryRepository';
import { createDailyRouter } from './daily';

const auth: RequestHandler = (req, _res, next) => {
  req.user = { userId: 'user-1', email: 'owner@example.com', role: 'admin' };
  next();
};

/** The single fib entry the fixture used to write to content/daily.json. */
const fibEntry: DailyEntryRecord = {
  entryId: 'fib-1',
  type: 'fib',
  difficulty: 1,
  questionId: null,
  topicKey: null,
  prompt: 'A ___ stores key-value pairs.',
  blanks: ['hash table'],
  hint: null,
};

describe('daily routes', () => {
  const query = vi.fn();
  const listDailyEntries = vi.fn();
  const getQuestion = vi.fn();
  const listSiblingBlocks = vi.fn();

  beforeEach(() => {
    query.mockReset();
    listDailyEntries.mockReset().mockResolvedValue([fibEntry]);
    getQuestion.mockReset();
    listSiblingBlocks.mockReset();
  });

  function app(overrides: Record<string, unknown> = {}) {
    const instance = express();
    instance.use(express.json());
    instance.use(
      '/daily',
      createDailyRouter({
        query,
        repo: {
          listDailyEntries,
          getQuestion,
          listSiblingBlocks,
        } as unknown as LibraryRepository,
        requireAuth: auth,
        requireAdmin: auth,
        secret: '0123456789abcdef0123456789abcdef',
        timeZone: 'Asia/Ho_Chi_Minh',
        recordStudyDay: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      } as never),
    );
    return instance;
  }

  it('does not expose answer keys and grades raw answers on the server', async () => {
    const challenge = await request(app()).get('/daily').expect(200);

    expect(challenge.body.questions[0]).not.toHaveProperty('blanks');
    expect(challenge.body.questions[0]).toMatchObject({ type: 'fib', blankCount: 1 });
    expect(challenge.body.challenge).toEqual(expect.any(String));

    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ activity_date: challenge.body.date }] });
    const completion = await request(app())
      .post('/daily/complete')
      .send({
        date: challenge.body.date,
        challenge: challenge.body.challenge,
        answers: [{ questionId: 'fib-1', blanks: ['Hash Table'] }],
        score: 0,
        total: 999,
      })
      .expect(200);

    expect(query.mock.calls[0]?.[1]?.slice(2)).toEqual([1, 1]);
    expect(completion.body).toMatchObject({ ok: true, score: 1, total: 1 });
  });

  it('rejects a modified challenge token', async () => {
    const challenge = await request(app()).get('/daily').expect(200);
    await request(app())
      .post('/daily/complete')
      .send({ date: challenge.body.date, challenge: `${challenge.body.challenge}x`, answers: [] })
      .expect(400);

    expect(query).not.toHaveBeenCalled();
  });

  it('rejects duplicate and unknown answer IDs before persisting completion', async () => {
    const duplicateChallenge = await request(app()).get('/daily').expect(200);
    await request(app())
      .post('/daily/complete')
      .send({
        date: duplicateChallenge.body.date,
        challenge: duplicateChallenge.body.challenge,
        answers: [
          { questionId: 'fib-1', blanks: ['Hash Table'] },
          { questionId: 'fib-1', blanks: ['Hash Table'] },
        ],
      })
      .expect(400);

    const unknownChallenge = await request(app()).get('/daily').expect(200);
    await request(app())
      .post('/daily/complete')
      .send({
        date: unknownChallenge.body.date,
        challenge: unknownChallenge.body.challenge,
        answers: [{ questionId: 'unknown', blanks: ['Hash Table'] }],
      })
      .expect(400);

    expect(query).not.toHaveBeenCalled();
  });

  it('reads the Daily pool from the repository for the requested locale', async () => {
    const challenge = await request(app()).get('/daily').expect(200);

    expect(listDailyEntries).toHaveBeenCalledWith({ locale: 'vi' });
    expect(challenge.body.questions).toHaveLength(1);
  });

  it('builds an MCQ from the referenced question and its siblings', async () => {
    listDailyEntries.mockResolvedValue([
      {
        entryId: 'mcq-1',
        type: 'mcq',
        difficulty: 1,
        questionId: 'q1',
        topicKey: 'javascript',
        prompt: null,
        blanks: null,
        hint: null,
      },
    ]);
    getQuestion.mockResolvedValue({
      blocks: [{ type: 'text', text: 'Closures capture the enclosing scope.' }],
      questionText: 'Closure là gì?',
    });
    listSiblingBlocks.mockResolvedValue([
      [{ type: 'text', text: 'A promise represents a future value that may resolve.' }],
      [{ type: 'text', text: 'An event loop schedules callbacks onto the task queue.' }],
      [{ type: 'text', text: 'A module caches its exports after the first evaluation.' }],
    ]);

    const challenge = await request(app()).get('/daily').expect(200);

    expect(getQuestion).toHaveBeenCalledWith({ questionId: 'q1' });
    expect(listSiblingBlocks).toHaveBeenCalledWith({
      topicKey: 'javascript',
      locale: 'vi',
      excludeQuestionId: 'q1',
    });
    const question = challenge.body.questions[0];
    expect(question).toMatchObject({ id: 'mcq-1', type: 'mcq', q: 'Closure là gì?' });
    expect(question.options).toHaveLength(4);
    expect(
      question.options.some((option: { text: string }) =>
        option.text.startsWith('Closures capture'),
      ),
    ).toBe(true);
    expect(question).not.toHaveProperty('correctIdx');
  });

  it('serves English questions for lang=en', async () => {
    await request(app()).get('/daily?lang=en').expect(200);

    expect(listDailyEntries).toHaveBeenCalledWith({ locale: 'en' });
  });

  it('rejects an unsupported locale', async () => {
    const res = await request(app()).get('/daily?lang=fr').expect(400);

    expect(res.body.code).toBe('unsupported_language');
    expect(listDailyEntries).not.toHaveBeenCalled();
  });

  it('enqueues the Daily summary inside the completion transaction', async () => {
    const challenge = await request(app()).get('/daily').expect(200);
    const tx = vi.fn().mockResolvedValue({ rows: [] });
    const withTransaction = vi.fn(async (fn: (q: typeof tx) => Promise<unknown>) => fn(tx));
    const enqueueDailySummary = vi.fn().mockResolvedValue(undefined);
    query.mockResolvedValue({ rows: [{ activity_date: challenge.body.date }] });

    await request(app({ withTransaction, enqueueDailySummary }))
      .post('/daily/complete')
      .send({
        date: challenge.body.date,
        challenge: challenge.body.challenge,
        answers: [{ questionId: 'fib-1', blanks: ['Hash Table'] }],
      })
      .expect(200);

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(tx.mock.calls[0]?.[0]).toContain('INSERT INTO daily_completions');
    expect(enqueueDailySummary).toHaveBeenCalledTimes(1);
    const [input, transaction] = enqueueDailySummary.mock.calls[0] as [
      { ownerId: string; date: string; score: number; total: number; idempotencyKey: string },
      unknown,
    ];
    expect(input).toMatchObject({
      ownerId: 'user-1',
      date: challenge.body.date,
      score: 1,
      total: 1,
    });
    expect(input.idempotencyKey).toBe(`daily_${challenge.body.date}_user-1`);
    expect(transaction).toBe(tx);
  });

  it('reuses the completion\u2019s stable idempotency key on a retry', async () => {
    const enqueueDailySummary = vi.fn().mockResolvedValue(undefined);
    const first = await request(app()).get('/daily').expect(200);
    const second = await request(app()).get('/daily').expect(200);
    query.mockResolvedValue({ rows: [{ activity_date: first.body.date }] });

    for (const challenge of [first, second]) {
      await request(app({ enqueueDailySummary }))
        .post('/daily/complete')
        .send({
          date: challenge.body.date,
          challenge: challenge.body.challenge,
          answers: [{ questionId: 'fib-1', blanks: ['Hash Table'] }],
        })
        .expect(200);
    }

    expect(enqueueDailySummary).toHaveBeenCalledTimes(2);
    const keys = enqueueDailySummary.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(`daily_${first.body.date}_user-1`);
  });

  it('rolls back the completion when the summary job cannot be enqueued', async () => {
    const challenge = await request(app()).get('/daily').expect(200);
    query.mockResolvedValue({ rows: [{ activity_date: challenge.body.date }] });
    const committed: unknown[] = [];
    const withTransaction = vi.fn(
      async (
        fn: (
          q: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>,
        ) => Promise<unknown>,
      ) => {
        const draft: unknown[] = [];
        const tx = vi.fn(async (text: string, values: unknown[] = []) => {
          draft.push({ text, values });
          return { rows: [] };
        });
        const result = await fn(tx);
        committed.push(...draft);
        return result;
      },
    );
    const enqueueDailySummary = vi.fn().mockRejectedValue(new Error('outbox unavailable'));

    await request(app({ withTransaction, enqueueDailySummary }))
      .post('/daily/complete')
      .send({
        date: challenge.body.date,
        challenge: challenge.body.challenge,
        answers: [{ questionId: 'fib-1', blanks: ['Hash Table'] }],
      })
      .expect(500);

    expect(committed).toHaveLength(0);
  });
});
