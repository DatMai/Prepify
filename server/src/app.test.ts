import type { Express } from 'express';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, type AppDependencies } from './app';
import { loadConfig } from './config/env';
import { AppError } from './shared/errors/appError';

function testDependencies(registerRoutes: (app: Express) => void = () => {}): AppDependencies {
  return {
    config: loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://prepify:secret@localhost:5432/prepify_test',
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      FRONTEND_URL: 'http://localhost:5173',
    }),
    logger: pino({ level: 'silent' }),
    registerRoutes,
    readiness: async () => {},
  };
}

describe('application shell', () => {
  it('returns liveness with a request id', async () => {
    const response = await request(createApp(testDependencies())).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports unavailable when the readiness dependency fails', async () => {
    const app = createApp({
      ...testDependencies(),
      readiness: async () => {
        throw new Error('database offline');
      },
    });

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(response.body)).not.toContain('database offline');
  });

  it('maps expected errors to the public envelope', async () => {
    const app = createApp(
      testDependencies((target) => {
        target.get('/failure', () => {
          throw new AppError(403, 'AUTH_FORBIDDEN', 'Forbidden');
        });
      }),
    );

    const response = await request(app).get('/failure');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('does not leak unexpected exception details', async () => {
    const app = createApp(
      testDependencies((target) => {
        target.get('/failure', () => {
          throw new Error('database password leaked');
        });
      }),
    );

    const response = await request(app).get('/failure');

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('database password leaked');
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns the same error contract for an unknown route', async () => {
    const response = await request(createApp(testDependencies())).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('HTTP_NOT_FOUND');
  });
});
