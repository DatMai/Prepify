import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requireAdmin } from '../../middleware/admin';
import { createOptionalSessionAuth, createSessionAuth } from './sessionAuth';
import { sessionCookieOptions } from './sessionCookie';
import type { SessionRepository } from './sessionRepository';

function repositoryWith(
  result: Awaited<ReturnType<SessionRepository['findActive']>>,
): SessionRepository {
  return {
    create: async () => {},
    findActive: async () => result,
    revoke: async () => {},
    revokeAllForUser: async () => {},
  };
}

function testApp(repository: SessionRepository) {
  const app = express();
  app.get('/private', createSessionAuth(repository, 'prepify_session'), (req, res) => {
    res.json({ user: req.user, sessionId: req.authSession?.id });
  });
  app.get('/admin', createSessionAuth(repository, 'prepify_session'), requireAdmin, (_req, res) =>
    res.json({ ok: true }),
  );
  return app;
}

describe('session authentication', () => {
  it('keeps a public route anonymous when no session cookie exists', async () => {
    const app = express();
    app.get(
      '/public',
      createOptionalSessionAuth(repositoryWith(null), 'prepify_session'),
      (req, res) => res.json({ authenticated: Boolean(req.user) }),
    );

    const response = await request(app).get('/public');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authenticated: false });
  });

  it('rejects missing and unknown cookies with the same public response', async () => {
    const app = testApp(repositoryWith(null));

    const missing = await request(app).get('/private');
    const unknown = await request(app).get('/private').set('Cookie', 'prepify_session=unknown');

    expect(missing.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(missing.body);
  });

  it('attaches the current database user and session id', async () => {
    const app = testApp(
      repositoryWith({
        sessionId: 'session-1',
        user: {
          id: 'user-1',
          email: 'admin@example.com',
          displayName: 'Admin',
          avatarId: 1,
          location: null,
          emailVerifiedAt: null,
          role: 'admin',
        },
      }),
    );

    const response = await request(app).get('/private').set('Cookie', 'prepify_session=opaque');

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ userId: 'user-1', role: 'admin' });
    expect(response.body.sessionId).toBe('session-1');
  });

  it('authorizes admin from the resolved session role', async () => {
    const userApp = testApp(
      repositoryWith({
        sessionId: 'session-2',
        user: {
          id: 'user-2',
          email: 'user@example.com',
          displayName: null,
          avatarId: 1,
          location: null,
          emailVerifiedAt: null,
          role: 'user',
        },
      }),
    );

    const response = await request(userApp).get('/admin').set('Cookie', 'prepify_session=opaque');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('admin_required');
  });

  it('uses matching secure cookie attributes for set and clear', () => {
    expect(sessionCookieOptions(true, 60_000)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60_000,
    });
    expect(sessionCookieOptions(false)).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
  });
});
