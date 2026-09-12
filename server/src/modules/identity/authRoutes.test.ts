import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAuthRoutes, type AuthRouteService } from './authRoutes';
import type { PublicUser } from './sessionRepository';

const user: PublicUser = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'User',
  avatarId: 1,
  location: null,
  emailVerifiedAt: null,
  role: 'user',
};

function service(overrides: Partial<AuthRouteService> = {}): AuthRouteService {
  return {
    register: vi.fn().mockResolvedValue({ user, token: 'register-secret' }),
    login: vi.fn().mockResolvedValue({ user, token: 'login-secret' }),
    currentUser: vi.fn().mockResolvedValue(user),
    logout: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn().mockResolvedValue(user),
    ...overrides,
  };
}

function appFor(authService: AuthRouteService) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.header('x-test-user')) {
      req.user = { userId: 'user-1', email: user.email, role: 'user' };
      req.authSession = { id: 'session-1', token: 'raw-cookie' };
    }
    next();
  });
  app.use(
    '/auth',
    createAuthRoutes({
      service: authService,
      cookie: { name: 'prepify_session', secure: false, maxAgeMs: 60_000 },
      requireAuth: (req, res, next) => {
        if (!req.user) {
          res.status(401).json({ error: 'Authentication required', code: 'auth_required' });
          return;
        }
        next();
      },
      rateLimit: false,
    }),
  );
  return app;
}

describe('identity routes', () => {
  it('registers and returns only the public user while setting an HttpOnly cookie', async () => {
    const response = await request(appFor(service()))
      .post('/auth/register')
      .send({ email: user.email, password: 'StrongPass1!', displayName: 'User' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ user });
    expect(response.body).not.toHaveProperty('token');
    expect(response.headers['set-cookie']?.[0]).toContain('prepify_session=register-secret');
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('uses a generic response for invalid credentials', async () => {
    const invalid = Object.assign(new Error('wrong password'), { code: 'invalid_credentials' });
    const response = await request(appFor(service({ login: vi.fn().mockRejectedValue(invalid) })))
      .post('/auth/login')
      .send({ email: user.email, password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'Unable to sign in',
      code: 'invalid_credentials',
    });
  });

  it('restores the current user without exposing the session token', async () => {
    const response = await request(appFor(service()))
      .get('/auth/session')
      .set('x-test-user', 'yes');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user });
    expect(JSON.stringify(response.body)).not.toContain('raw-cookie');
  });

  it('revokes and clears the current session on logout', async () => {
    let revokedToken = '';
    const authService = service({
      logout: async (token) => {
        revokedToken = token;
      },
    });
    const response = await request(appFor(authService))
      .delete('/auth/session')
      .set('x-test-user', 'yes');

    expect(response.status).toBe(204);
    expect(revokedToken).toBe('raw-cookie');
    expect(response.headers['set-cookie']?.[0]).toContain('prepify_session=;');
  });
});
