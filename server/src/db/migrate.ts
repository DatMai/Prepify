import fs from 'node:fs';
import path from 'node:path';
import { db } from './client';

async function migrate(): Promise<void> {
  const migDir = path.join(__dirname, '../../migrations');
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migDir, file), 'utf8');
    console.log(`[migrate] running ${file}`);
    await db.query(sql);
    console.log(`[migrate] ✓ ${file}`);
  }

  await db.end();
  console.log('[migrate] done');
}

migrate().catch((err) => {
  console.error('[migrate] failed:', err.message);
  process.exit(1);
});
