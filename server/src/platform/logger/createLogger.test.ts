import type { DestinationStream } from 'pino';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config/env';
import { createLogger } from './createLogger';

describe('createLogger', () => {
  it('redacts credentials from structured log records', () => {
    const output: string[] = [];
    const destination: DestinationStream = {
      write(chunk: string) {
        output.push(chunk);
      },
    };
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://prepify:secret@localhost:5432/prepify_test',
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
    });
    const logger = createLogger(config, destination);

    logger.info({
      password: 'plain-password',
      token: 'plain-token',
      req: { headers: { authorization: 'Bearer credential', cookie: 'session=credential' } },
    });

    const record = output.join('');
    expect(record).not.toContain('plain-password');
    expect(record).not.toContain('plain-token');
    expect(record).not.toContain('Bearer credential');
    expect(record).not.toContain('session=credential');
    expect(record).toContain('[Redacted]');
  });
});
