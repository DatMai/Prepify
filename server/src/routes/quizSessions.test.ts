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

    const response = await request(app(query as QuizSessionQuery)).get('/quiz-sessions/my').expect(200);

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
});
