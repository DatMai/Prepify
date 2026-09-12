import { Pool } from 'pg';
import type { Logger } from 'pino';

let databasePool: Pool | undefined;

export function createPool(databaseUrl: string, logger: Logger): Pool {
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on('error', (error) => {
    logger.error({ err: error }, 'unexpected database pool error');
  });
  return pool;
}

export function initializeDatabase(pool: Pool): void {
  if (databasePool && databasePool !== pool) {
    throw new Error('Database pool has already been initialized');
  }
  databasePool = pool;
}

function getDatabasePool(): Pool {
  if (!databasePool) {
    throw new Error('Database pool has not been initialized');
  }
  return databasePool;
}

export const db = new Proxy({} as Pool, {
  get(_target, prop) {
    const pool = getDatabasePool();
    const value = Reflect.get(pool, prop, pool) as unknown;
    return typeof value === 'function' ? value.bind(pool) : value;
  },
});
