import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAdminRouter } from './admin';

function app(
  repo: Parameters<typeof createAdminRouter>[0]['repo'],
  role: 'admin' | 'user' = 'admin',
) {
  const instance = express();
  instance.use(express.json());
  const requireAuth: RequestHandler = (req, _res, next) => {
    req.user = { userId: role === 'admin' ? 'admin-1' : 'user-1', email: 'a@b.c', role };
    next();
  };
  const requireAdmin: RequestHandler = (req, res, next) => {
    if (req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required', code: 'admin_required' });
      return;
    }
    next();
  };
  instance.use('/admin', createAdminRouter({ repo, requireAuth, requireAdmin }));
  return instance;
}

type Repo = Parameters<typeof createAdminRouter>[0]['repo'];

describe('admin routes', () => {
  it('rejects non-admin users with 403', async () => {
    const repo = { stats: vi.fn() } as unknown as Repo;

    await request(app(repo, 'user')).get('/admin/stats').expect(403);
    expect(repo.stats).not.toHaveBeenCalled();
  });

  it('returns dashboard stats', async () => {
    const repo = {
      stats: vi.fn().mockResolvedValue({
        totalUsers: 10,
        totalAdmins: 2,
        activeSessions: 5,
        dailyCompletionsToday: 3,
      }),
    } as unknown as Repo;

    const res = await request(app(repo)).get('/admin/stats').expect(200);

    expect(res.body).toEqual({
      totalUsers: 10,
      totalAdmins: 2,
      activeSessions: 5,
      dailyCompletionsToday: 3,
    });
  });

  it('lists users and rejects a self-role change', async () => {
    const repo = {
      listUsers: vi.fn().mockResolvedValue({ total: 1, items: [] }),
      findById: vi.fn().mockResolvedValue(null),
    } as unknown as Repo;

    await request(app(repo)).get('/admin/users?search=a&limit=10&offset=0').expect(200);

    await request(app(repo)).patch('/admin/users/admin-1').send({ role: 'user' }).expect(400);
  });

  it('updates another user with a role patch', async () => {
    const repo = {
      findById: vi.fn().mockResolvedValue({ id: 'other-1', role: 'user' }),
      setRole: vi.fn().mockResolvedValue(undefined),
      setDisabled: vi.fn().mockResolvedValue(undefined),
    } as unknown as Repo;

    await request(app(repo)).patch('/admin/users/other-1').send({ role: 'admin' }).expect(204);

    expect(repo.setRole).toHaveBeenCalledWith('other-1', 'admin');
  });

  it('rejects an empty patch', async () => {
    const repo = { findById: vi.fn() } as unknown as Repo;

    await request(app(repo)).patch('/admin/users/other-1').send({}).expect(400);
  });
});
