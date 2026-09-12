import path from 'node:path';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true, quiet: true });

import { loadConfig } from '../config/env';
import { createPool } from '../db/client';
import { applySeedPlan, buildSeedPlan } from '../modules/library/librarySeed';
import type { LibraryQuery, Locale } from '../modules/library/libraryRepository';

const LOCALES: Locale[] = ['vi', 'en'];

async function seed(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = pino({ level: config.nodeEnv === 'development' ? 'debug' : 'info' });
  const pool = createPool(config.databaseUrl, logger);
  const corpusDir = path.resolve(__dirname, '../../../content');
  try {
    for (const locale of LOCALES) {
      const dir = locale === 'vi' ? corpusDir : path.join(corpusDir, 'en');
      try {
        const plan = buildSeedPlan(dir, locale);
        for (const warning of plan.warnings) logger.warn(warning);
        const summary = await applySeedPlan(pool.query.bind(pool) as unknown as LibraryQuery, plan);
        logger.info({ locale, ...summary }, 'library seed complete');
      } catch (error: unknown) {
        // content/en/ is gitignored; a missing locale is expected, not fatal.
        if (locale !== 'vi' && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          logger.warn({ locale }, 'corpus missing for locale; skipped');
          continue;
        }
        throw error;
      }
    }
  } finally {
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  pino().fatal({ err: error }, 'library seed failed');
  process.exit(1);
});
