import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('database adapter', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects access before the composition root initializes the pool', async () => {
    const { db } = await import('./client');

    expect(() => db.query).toThrow(/Database pool has not been initialized/);
  });

  it('delegates queries to the explicitly initialized pool', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ value: 1 }] });
    const pool = { query } as unknown as Pool;
    const { db, initializeDatabase } = await import('./client');

    initializeDatabase(pool);
    const result = await db.query<{ value: number }>('SELECT 1 AS value');

    expect(result.rows).toEqual([{ value: 1 }]);
  });
});
