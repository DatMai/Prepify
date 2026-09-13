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

  it('treats blank optional values as unset', () => {
    const config = loadConfig({
      ...valid,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      FACEBOOK_APP_ID: '',
      FACEBOOK_APP_SECRET: '',
      EMAIL_USER: '',
      EMAIL_PASS: '',
    });

    expect(config.oauth.google).toBeUndefined();
    expect(config.oauth.facebook).toBeUndefined();
    expect(config.email.user).toBeUndefined();
    expect(config.email.password).toBeUndefined();
  });

  it('normalizes an explicit content root', () => {
    expect(loadConfig({ ...valid, CONTENT_ROOT: '/tmp/prepify-content' }).contentRoot).toBe(
      '/tmp/prepify-content',
    );
  });

  it('treats a blank content root as unset', () => {
    expect(loadConfig({ ...valid, CONTENT_ROOT: '' }).contentRoot).toBeUndefined();
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

  it('leaves the hosted bridge disabled without a credential by default', () => {
    const config = loadConfig(valid);

    expect(config.obsidian.bridge.enabled).toBe(false);
    expect(config.obsidian.bridge.token).toBeUndefined();
    expect(config.obsidian.vaultId).toBe('vault-main');
  });

  it('requires a bridge credential when hosted sync is enabled', () => {
    expect(() => loadConfig({ ...valid, OBSIDIAN_BRIDGE_ENABLED: 'true' })).toThrow(
      /OBSIDIAN_BRIDGE_TOKEN/,
    );
  });

  it('rejects a bridge credential shorter than 32 characters', () => {
    expect(() =>
      loadConfig({
        ...valid,
        OBSIDIAN_BRIDGE_ENABLED: 'true',
        OBSIDIAN_BRIDGE_TOKEN: 'short-bridge-credential',
      }),
    ).toThrow(/OBSIDIAN_BRIDGE_TOKEN/);
  });

  it('requires an owner identity when hosted sync is enabled', () => {
    // Without it the server boots and then rejects every bridge authentication
    // and Journey request, so the failure belongs at startup.
    expect(() =>
      loadConfig({
        ...valid,
        OBSIDIAN_BRIDGE_ENABLED: 'true',
        OBSIDIAN_BRIDGE_TOKEN: 'c'.repeat(48),
      }),
    ).toThrow(/OBSIDIAN_OWNER_EMAIL/);
  });

  it('accepts an explicit bridge credential and vault identity', () => {
    const config = loadConfig({
      ...valid,
      OBSIDIAN_BRIDGE_ENABLED: 'true',
      OBSIDIAN_BRIDGE_TOKEN: 'c'.repeat(48),
      OBSIDIAN_OWNER_EMAIL: 'owner@example.test',
      OBSIDIAN_VAULT_ID: 'hehe-vault',
    });

    expect(config.obsidian.bridge).toEqual({ enabled: true, token: 'c'.repeat(48) });
    expect(config.obsidian.vaultId).toBe('hehe-vault');
  });

  it('rejects an unsafe vault identity', () => {
    expect(() => loadConfig({ ...valid, OBSIDIAN_VAULT_ID: '../vault' })).toThrow(
      /OBSIDIAN_VAULT_ID/,
    );
  });
});
