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

  it('runs the pre-close hook exactly once before closing the pool', async () => {
    const app = express();
    const events: string[] = [];
    const runtime = await startServer({
      app,
      host: '127.0.0.1',
      port: 0,
      logger: pino({ level: 'silent' }),
      beforeClose: async () => {
        events.push(`beforeClose:${runtime.server.listening}`);
      },
      closePool: async () => {
        events.push('closePool');
      },
    });

    await Promise.all([runtime.stop(), runtime.stop()]);

    expect(events).toEqual(['beforeClose:true', 'closePool']);
  });
});
