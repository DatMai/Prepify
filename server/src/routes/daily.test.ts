import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDailyRouter } from './daily';

const auth: RequestHandler = (req, _res, next) => {
  req.user = { userId: 'user-1', email: 'owner@example.com', role: 'admin' };
  next();
};

describe('daily routes', () => {
  let contentDir: string;
  const query = vi.fn();

  beforeEach(() => {
    contentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepify-daily-'));
    fs.writeFileSync(
      path.join(contentDir, 'daily.json'),
      JSON.stringify({
        version: 1,
        pool: [
          {
            id: 'fib-1',
            type: 'fib',
            difficulty: 1,
            prompt: 'A ___ stores key-value pairs.',
            blanks: ['hash table'],
          },
        ],
      }),
    );
    query.mockReset();
  });

  afterEach(() => fs.rmSync(contentDir, { recursive: true, force: true }));

  function app() {
    const instance = express();
    instance.use(express.json());
    instance.use(
      '/daily',
      createDailyRouter({
        query,
        requireAuth: auth,
        requireAdmin: auth,
        secret: '0123456789abcdef0123456789abcdef',
        timeZone: 'Asia/Ho_Chi_Minh',
        contentDir,
        recordStudyDay: vi.fn().mockResolvedValue(undefined),
      }),
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
});
