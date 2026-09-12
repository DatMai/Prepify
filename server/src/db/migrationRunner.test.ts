import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { runMigrations } from './migrationRunner';

it('executes SQL migration files in lexical order', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prepify-migrations-'));
  const query = vi.fn().mockResolvedValue({ rows: [] });

  try {
    await fs.writeFile(path.join(directory, '002_second.sql'), 'SELECT 2;', 'utf8');
    await fs.writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;', 'utf8');
    await fs.writeFile(path.join(directory, 'README.md'), 'ignored', 'utf8');

    await runMigrations({ query } as unknown as Pool, directory);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['SELECT 1;', 'SELECT 2;']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
