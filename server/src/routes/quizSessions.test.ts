import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQuizSessionsRouter, type QuizSessionQuery } from './quizSessions';

const auth: RequestHandler = (req, _res, next) => {
  req.user = { userId: 'user-1', email: 'user@example.com', role: 'user' };
  next();
};

function app(query: QuizSessionQuery) {
  const instance = express();
  instance.use(express.json());
  instance.use('/quiz-sessions', createQuizSessionsRouter({ query, requireAuth: auth }));
  return instance;
}

describe('quiz session routes', () => {
  const query = vi.fn();
  // quiz_sessions.total is PostgreSQL INT (migration 002), so its signed maximum is 2_147_483_647.
  const postgresIntMax = 2_147_483_647;

  beforeEach(() => {
    query.mockReset().mockResolvedValue({
      rows: [{ id: 'session-1', completed_at: '2026-09-12T10:00:00.000Z' }],
    });
  });

  it('rejects client-asserted scored MCQ sessions', async () => {
    const response = await request(app(query as QuizSessionQuery))
      .post('/quiz-sessions')
      .send({ topicKey: 'javascript', mode: 'mcq', total: 5, score: 5 })
      .expect(422);

    expect(response.body.code).toBe('scored_attempt_required');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a score field on flashcard activity', async () => {
    const response = await request(app(query as QuizSessionQuery))
      .post('/quiz-sessions')
      .send({ topicKey: 'javascript', mode: 'flashcard', total: 5, score: 5 })
      .expect(422);

    expect(response.body.code).toBe('scored_attempt_required');
    expect(query).not.toHaveBeenCalled();
  });

  it('accepts non-scored flashcard activity', async () => {
    await request(app(query as QuizSessionQuery))
      .post('/quiz-sessions')
      .send({ topicKey: 'javascript', mode: 'flashcard', total: 5 })
      .expect(201);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO quiz_sessions'), [
      'user-1',
      'javascript',
      'flashcard',
      5,
    ]);
  });

  it.each([
    ['a fractional total', 1.5],
    ['an unsafe total', Number.MAX_SAFE_INTEGER],
  ])('rejects %s before querying', async (_description, total) => {
    const response = await request(app(query as QuizSessionQuery))
      .post('/quiz-sessions')
      .send({ topicKey: 'javascript', mode: 'flashcard', total })
      .expect(400);

    expect(response.body.error).toBe('topicKey, mode (flashcard), total là bắt buộc và hợp lệ');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a topic key longer than the VARCHAR(50) storage bound before querying', async () => {
    const response = await request(app(query as QuizSessionQuery))
      .post('/quiz-sessions')
      .send({ topicKey: 'a'.repeat(51), mode: 'flashcard', total: 1 })
      .expect(400);

    expect(response.body.error).toBe('topicKey, mode (flashcard), total là bắt buộc và hợp lệ');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a blank topic key before querying', async () => {
    const response = await request(app(query as QuizSessionQuery))
      .post('/quiz-sessions')
      .send({ topicKey: '   ', mode: 'flashcard', total: 1 })
      .expect(400);

    expect(response.body.error).toBe('topicKey, mode (flashcard), total là bắt buộc và hợp lệ');
    expect(query).not.toHaveBeenCalled();
  });

  it('accepts the PostgreSQL INT maximum as a flashcard total', async () => {
    await request(app(query as QuizSessionQuery))
      .post('/quiz-sessions')
      .send({ topicKey: 'javascript', mode: 'flashcard', total: postgresIntMax })
      .expect(201);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO quiz_sessions'), [
      'user-1',
      'javascript',
      'flashcard',
      postgresIntMax,
    ]);
  });

  it('returns nullable scores from session history', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'session-1',
          topic_key: 'javascript',
          mode: 'flashcard',
          total: 5,
          score: null,
          completed_at: '2026-09-12T10:00:00.000Z',
        },
      ],
    });

    const response = await request(app(query as QuizSessionQuery))
      .get('/quiz-sessions/my')
      .expect(200);

    expect(response.body.sessions).toEqual([
      {
        id: 'session-1',
        topicKey: 'javascript',
        mode: 'flashcard',
        total: 5,
        score: null,
        completedAt: '2026-09-12T10:00:00.000Z',
      },
    ]);
  });

  it('does not expose legacy scored MCQ sessions in history', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'legacy-mcq',
          topic_key: 'javascript',
          mode: 'mcq',
          total: 5,
          score: 5,
          completed_at: '2026-09-12T11:00:00.000Z',
        },
        {
          id: 'flashcard-1',
          topic_key: 'typescript',
          mode: 'flashcard',
          total: 3,
          score: null,
          completed_at: '2026-09-12T10:00:00.000Z',
        },
      ],
    });

    const response = await request(app(query as QuizSessionQuery))
      .get('/quiz-sessions/my')
      .expect(200);

    expect(response.body.sessions).toEqual([
      {
        id: 'flashcard-1',
        topicKey: 'typescript',
        mode: 'flashcard',
        total: 3,
        score: null,
        completedAt: '2026-09-12T10:00:00.000Z',
      },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("AND mode = 'flashcard'"), [
      'user-1',
    ]);
  });
});
