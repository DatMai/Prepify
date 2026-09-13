import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRecoveryRoutes, type RecoveryRouteService } from './recoveryRoutes';

function appFor(service: RecoveryRouteService) {
  const app = express();
  app.use(express.json());
  app.use(
    '/auth',
    createRecoveryRoutes({
      service,
      frontendUrl: 'https://prepify.example',
      requireAuth: (req, _res, next) => {
        req.user = { userId: 'user-1', email: 'user@example.com', role: 'user' };
        next();
      },
      rateLimit: false,
    }),
  );
  return app;
}

function service(overrides: Partial<RecoveryRouteService> = {}): RecoveryRouteService {
  return {
    requestPasswordReset: async () => {},
    resetPassword: async () => {},
    requestEmailVerification: async () => {},
    verifyEmail: async () => false,
    ...overrides,
  };
}

describe('recovery routes', () => {
  it('uses the same successful response whether an account exists or not', async () => {
    const missing = await request(appFor(service())).post('/auth/forgot/email').send({
      email: 'missing@example.com',
    });
    const existing = await request(appFor(service())).post('/auth/forgot/email').send({
      email: 'existing@example.com',
    });

    expect(existing.status).toBe(200);
    expect(existing.body).toEqual(missing.body);
  });

  it('never returns a reset token in the forgot response', async () => {
    const response = await request(appFor(service())).post('/auth/forgot/email').send({
      email: 'user@example.com',
    });

    expect(JSON.stringify(response.body)).not.toContain('token');
  });

  it('does not expose account existence when password-reset delivery fails', async () => {
    const response = await request(
      appFor(
        service({
          requestPasswordReset: async () => {
            throw Object.assign(new Error('SMTP authentication failed'), {
              code: 'email_delivery_failed',
            });
          },
        }),
      ),
    )
      .post('/auth/forgot/email')
      .send({ email: 'user@example.com' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      message: 'If the email exists, a reset link has been sent.',
    });
    expect(JSON.stringify(response.body)).not.toContain('SMTP');
  });

  it('reports verification delivery failures to the signed-in client', async () => {
    const response = await request(
      appFor(
        service({
          requestEmailVerification: async () => {
            throw Object.assign(new Error('SMTP authentication failed'), {
              code: 'email_delivery_failed',
            });
          },
        }),
      ),
    ).post('/auth/resend-verification');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('email_delivery_failed');
  });

  it('redirects email verification with status only', async () => {
    const response = await request(appFor(service({ verifyEmail: async () => true }))).get(
      '/auth/verify-email/raw-token',
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://prepify.example/?email_verified=1');
    expect(response.headers.location).not.toContain('raw-token');
  });
});
