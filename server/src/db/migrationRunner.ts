import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

export async function runMigrations(pool: Pool, directory: string): Promise<string[]> {
  const files = (await fs.readdir(directory))
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    const sql = await fs.readFile(path.join(directory, file), 'utf8');
    await pool.query(sql);
  }

  return files;
}
