import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeAuthMiddleware } from '../middleware/auth';
import type { LibraryRepository } from '../modules/library/libraryRepository';
import { createLibraryRouter } from './library';

type TestUser = { userId: string; email: string; role: 'user' | 'admin' };

let currentUser: TestUser | null = null;

const indexEntry = {
  key: 'dsa',
  label: 'DSA',
  title: 'Data Structures & Algorithms',
  subtitle: null,
  color: '#B71C1C',
  questionCount: 58,
};

function appWith(repo: Partial<LibraryRepository>) {
  const instance = express();
  instance.use(express.json());
  instance.use('/library', createLibraryRouter({ repo: repo as LibraryRepository }));
  return instance;
}

describe('library routes', () => {
  beforeEach(() => {
    currentUser = { userId: 'admin-1', email: 'admin@example.com', role: 'admin' };
    initializeAuthMiddleware((req, res, next) => {
      if (!currentUser) {
        res.status(401).json({ error: 'Authentication required', code: 'auth_required' });
        return;
      }
      req.user = currentUser;
      next();
    });
  });

  it('rejects an anonymous request and a non-admin session', async () => {
    const listTopics = vi.fn().mockResolvedValue([]);

    currentUser = null;
    await request(appWith({ listTopics })).get('/library/index').expect(401);

    currentUser = { userId: 'user-1', email: 'u@example.com', role: 'user' };
    const forbidden = await request(appWith({ listTopics })).get('/library/index').expect(403);

    expect(forbidden.body.code).toBe('admin_required');
    expect(listTopics).not.toHaveBeenCalled();
  });

  it('serves the index for a locale', async () => {
    const listTopics = vi.fn().mockResolvedValue([indexEntry]);

    const res = await request(appWith({ listTopics })).get('/library/index?lang=vi').expect(200);

    expect(listTopics).toHaveBeenCalledWith({ locale: 'vi' });
    expect(res.body).toEqual([indexEntry]);
  });

  it('defaults to vi when lang is absent', async () => {
    const listTopics = vi.fn().mockResolvedValue([]);

    await request(appWith({ listTopics })).get('/library/index').expect(200);

    expect(listTopics).toHaveBeenCalledWith({ locale: 'vi' });
  });

  it('rejects an unsupported locale', async () => {
    const listTopics = vi.fn();

    const res = await request(appWith({ listTopics })).get('/library/index?lang=fr').expect(400);

    expect(res.body.code).toBe('unsupported_language');
    expect(listTopics).not.toHaveBeenCalled();
  });

  it('serves a topic and 404s an unknown key', async () => {
    const getTopic = vi
      .fn()
      .mockResolvedValueOnce({ title: 'T', label: 'L', color: '#000000', sections: [] })
      .mockResolvedValueOnce(null);

    const found = await request(appWith({ getTopic }))
      .get('/library/topics/dsa?lang=vi')
      .expect(200);
    expect(found.body).toEqual({ title: 'T', label: 'L', color: '#000000', sections: [] });

    const missing = await request(appWith({ getTopic }))
      .get('/library/topics/nope?lang=vi')
      .expect(404);
    expect(missing.body.code).toBe('library_not_found');
  });

  it('rejects a malformed topic key before touching the repository', async () => {
    const getTopic = vi.fn();

    const res = await request(appWith({ getTopic }))
      .get('/library/topics/Bad_Key?lang=vi')
      .expect(400);

    expect(res.body.code).toBe('invalid_topic_key');
    expect(getTopic).not.toHaveBeenCalled();
  });

  it('serves an English topic for lang=en', async () => {
    const getTopic = vi
      .fn()
      .mockResolvedValue({ title: 'T', label: 'L', color: '#000000', sections: [] });

    await request(appWith({ getTopic })).get('/library/topics/dsa?lang=en').expect(200);

    expect(getTopic).toHaveBeenCalledWith({ key: 'dsa', locale: 'en' });
  });
});
