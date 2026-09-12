import { describe, expect, it } from 'vitest';
import { loadConfig } from './env';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://prepify:secret@localhost:5432/prepify_test',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  FRONTEND_URL: 'http://localhost:5173',
};

describe('loadConfig', () => {
  it('normalizes defaults and allowed origins', () => {
    const config = loadConfig(valid);

    expect(config.port).toBe(3001);
    expect(config.host).toBe('127.0.0.1');
    expect(config.corsOrigins).toEqual(['http://localhost:5173']);
    expect(config.session).toEqual({
      cookieName: 'prepify_session',
      secure: false,
      ttlHours: 168,
    });
    expect(config.timeZone).toBe('Asia/Ho_Chi_Minh');
  });

  it('uses a host-only secure cookie in production', () => {
    const config = loadConfig({ ...valid, NODE_ENV: 'production' });

    expect(config.session.cookieName).toBe('__Host-prepify_session');
    expect(config.session.secure).toBe(true);
  });

  it('rejects session lifetimes outside one hour to thirty days', () => {
    expect(() => loadConfig({ ...valid, SESSION_TTL_HOURS: '0' })).toThrow(/SESSION_TTL_HOURS/);
    expect(() => loadConfig({ ...valid, SESSION_TTL_HOURS: '721' })).toThrow(/SESSION_TTL_HOURS/);
  });

  it('fails before startup when required secrets are missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });

  it('requires a complete SMTP configuration when email delivery is enabled', () => {
    expect(() => loadConfig({ ...valid, EMAIL_DELIVERY_ENABLED: 'true' })).toThrow(/EMAIL_HOST/);
  });

  it('rejects a remotely bound Obsidian bridge', () => {
    expect(() =>
      loadConfig({
        ...valid,
        OBSIDIAN_SYNC_ENABLED: 'true',
        HOST: '0.0.0.0',
      }),
    ).toThrow(/Obsidian sync requires a loopback HOST/);
  });
});
