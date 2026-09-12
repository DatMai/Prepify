import path from 'node:path';
import dotenv from 'dotenv';
import type { Express } from 'express';
import pino from 'pino';
import swaggerUi from 'swagger-ui-express';
import { createApp } from './app';
import { loadConfig } from './config/env';
import { createPool, initializeDatabase } from './db/client';
import { createLogger } from './platform/logger/createLogger';
import { startServer } from './platform/server/startServer';
import authRouter from './routes/auth';
import dailyRouter from './routes/daily';
import forgotPasswordRouter from './routes/forgotPassword';
import journeyRouter from './routes/journey';
import leaderboardRouter from './routes/leaderboard';
import libraryRouter from './routes/library';
import oauthRouter from './routes/oauth';
import progressRouter from './routes/progress';
import quizSessionsRouter from './routes/quizSessions';
import streakRouter from './routes/streak';
import { syncConfiguredAdmins } from './services/adminBootstrap';
import { swaggerSpec } from './swagger';

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true, quiet: true });

function registerRoutes(app: Express): void {
  app.use('/auth', authRouter);
  app.use('/auth', forgotPasswordRouter);
  app.use('/auth', oauthRouter);
  app.use('/progress', progressRouter);
  app.use('/streak', streakRouter);
  app.use('/leaderboard', leaderboardRouter);
  app.use('/quiz-sessions', quizSessionsRouter);
  app.use('/daily', dailyRouter);
  app.use('/journey', journeyRouter);
  app.use('/library', libraryRouter);
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config);
  const pool = createPool(config.databaseUrl, logger);
  initializeDatabase(pool);

  try {
    await syncConfiguredAdmins();
    const app = createApp({
      config,
      logger,
      registerRoutes,
      readiness: async () => {
        await pool.query('SELECT 1');
      },
    });
    const runtime = await startServer({
      app,
      host: config.host,
      port: config.port,
      logger,
      closePool: async () => pool.end(),
    });

    const stop = (): void => {
      void runtime.stop().catch((error: unknown) => {
        logger.error({ err: error }, 'graceful shutdown failed');
        process.exitCode = 1;
      });
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    await pool.end();
    throw error;
  }
}

void main().catch((error: unknown) => {
  pino().fatal({ err: error }, 'server startup failed');
  process.exitCode = 1;
});
