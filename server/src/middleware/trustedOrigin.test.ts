import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { trustedOrigin } from './trustedOrigin';

function appWithOrigins(origins: string[]) {
  const app = express();
  app.use(trustedOrigin(origins));
  app.get('/resource', (_req, res) => res.json({ ok: true }));
  app.post('/resource', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('trusted origin middleware', () => {
  it('allows safe methods without an Origin header', async () => {
    const response = await request(appWithOrigins(['http://localhost:5173'])).get('/resource');

    expect(response.status).toBe(200);
  });

  it('rejects unsafe requests with missing or untrusted origins', async () => {
    const app = appWithOrigins(['http://localhost:5173']);

    const missing = await request(app).post('/resource');
    const hostile = await request(app).post('/resource').set('Origin', 'https://evil.example');

    expect(missing.status).toBe(403);
    expect(hostile.status).toBe(403);
    expect(hostile.body.code).toBe('untrusted_origin');
  });

  it('allows an unsafe request from an allowlisted origin', async () => {
    const response = await request(appWithOrigins(['http://localhost:5173']))
      .post('/resource')
      .set('Origin', 'http://localhost:5173');

    expect(response.status).toBe(200);
  });
});
