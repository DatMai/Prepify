import path from 'node:path';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true, quiet: true });

import { loadConfig } from '../config/env';
import { createPool } from './client';
import { runMigrations } from './migrationRunner';

async function migrate(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = pino({ level: config.nodeEnv === 'development' ? 'debug' : 'info' });
  const pool = createPool(config.databaseUrl, logger);
  const migDir = path.join(__dirname, '../../migrations');
  try {
    const files = await runMigrations(pool, migDir);
    logger.info({ migrations: files }, 'database migrations complete');
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  pino().fatal({ err }, 'database migration failed');
  process.exit(1);
});
