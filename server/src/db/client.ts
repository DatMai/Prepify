import { Pool } from 'pg';

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
    _pool.on('error', (err) => console.error('[db] unexpected error:', err.message));
  }
  return _pool;
}

export const db = new Proxy({} as Pool, {
  get(_target, prop) {
    return (getPool() as any)[prop as any];
  },
});
