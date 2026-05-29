import { Pool } from 'pg';

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

db.on('error', (err) => {
  console.error('[db] unexpected error:', err.message);
});
