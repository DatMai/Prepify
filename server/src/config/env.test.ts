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
  });

  it('fails before startup when required secrets are missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
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
