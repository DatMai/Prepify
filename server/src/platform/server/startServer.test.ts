import express from 'express';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { startServer } from './startServer';

describe('startServer', () => {
  it('stops accepting requests and closes resources exactly once', async () => {
    const app = express();
    let poolCloseCount = 0;
    const runtime = await startServer({
      app,
      host: '127.0.0.1',
      port: 0,
      logger: pino({ level: 'silent' }),
      closePool: async () => {
        poolCloseCount += 1;
      },
    });

    expect(runtime.server.listening).toBe(true);

    await Promise.all([runtime.stop(), runtime.stop()]);

    expect(runtime.server.listening).toBe(false);
    expect(poolCloseCount).toBe(1);
  });
});
