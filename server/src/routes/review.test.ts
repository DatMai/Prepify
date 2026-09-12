import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createReviewRouter } from './review';

const auth: RequestHandler = (req, _res, next) => {
  req.user = { userId: 'user-1', email: 'a@b.c', role: 'user' };
  next();
};

type Repo = Parameters<typeof createReviewRouter>[0]['repo'];

function app(repo: Repo, recordStudyDay = vi.fn().mockResolvedValue(undefined), timeZone = 'UTC') {
  const instance = express();
  instance.use(express.json());
  instance.use(
    '/review',
    createReviewRouter({
      repo,
      requireAuth: auth,
      timeZone,
      recordStudyDay,
      now: () => new Date('2026-09-12T10:00:00.000Z'),
    }),
  );
  return instance;
}

describe('review routes', () => {
  it('requires auth and returns due schedules', async () => {
    const repo = {
      listDue: vi.fn().mockResolvedValue([
        {
          topic: 'javascript',
          sectionIdx: 0,
          questionIdx: 0,
          intervalDays: 3,
          ease: 2.5,
          reviewCount: 1,
          dueAt: '2026-09-15T00:00:00.000Z',
        },
      ]),
    } as unknown as Repo;

    const res = await request(app(repo)).get('/review/due').expect(200);
    expect(res.body).toEqual({ count: 1, items: expect.any(Array) });
  });

  it('grades a card and records a study day', async () => {
    const repo = {
      listDue: vi.fn(),
      find: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({
        topic: 'javascript',
        sectionIdx: 0,
        questionIdx: 0,
        intervalDays: 7,
        ease: 2.55,
        reviewCount: 1,
        dueAt: '2026-09-19T00:00:00.000Z',
      }),
    } as unknown as Repo;
    const recordStudyDay = vi.fn().mockResolvedValue(undefined);

    const res = await request(app(repo, recordStudyDay))
      .post('/review/grade')
      .send({ topic: 'javascript', sectionIdx: 0, questionIdx: 0, quality: 'good' })
      .expect(200);

    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'javascript',
        sectionIdx: 0,
        questionIdx: 0,
        intervalDays: 7,
      }),
    );
    expect(recordStudyDay).toHaveBeenCalledWith('user-1');
    expect(res.body.schedule).toMatchObject({ intervalDays: 7, reviewCount: 1 });
  });

  it('schedules due_at at local midnight of the due day', async () => {
    const upsert = vi.fn().mockResolvedValue({
      topic: 'javascript',
      sectionIdx: 0,
      questionIdx: 0,
      intervalDays: 7,
      ease: 2.55,
      reviewCount: 1,
      dueAt: '2026-09-18T17:00:00.000Z',
    });
    const repo = {
      listDue: vi.fn(),
      find: vi.fn().mockResolvedValue(null),
      upsert,
    } as unknown as Repo;

    await request(app(repo, vi.fn().mockResolvedValue(undefined), 'Asia/Ho_Chi_Minh'))
      .post('/review/grade')
      .send({ topic: 'javascript', sectionIdx: 0, questionIdx: 0, quality: 'good' })
      .expect(200);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ dueAt: '2026-09-18T17:00:00.000Z' }),
    );
  });

  it('rejects invalid quality values', async () => {
    const repo = { listDue: vi.fn(), find: vi.fn(), upsert: vi.fn() } as unknown as Repo;

    await request(app(repo))
      .post('/review/grade')
      .send({ topic: 'javascript', sectionIdx: 0, questionIdx: 0, quality: 'nope' })
      .expect(400);
  });
});
