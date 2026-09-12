import path from 'node:path';
import dotenv from 'dotenv';
import type { Express } from 'express';
import pino from 'pino';
import swaggerUi from 'swagger-ui-express';
import { createApp } from './app';
import { loadConfig } from './config/env';
import { createPool, initializeDatabase } from './db/client';
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

const config = loadConfig(process.env);
const logger = pino({ level: config.nodeEnv === 'development' ? 'debug' : 'info' });
const pool = createPool(config.databaseUrl, logger);
initializeDatabase(pool);

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

const app = createApp({ config, logger, registerRoutes });

async function start(): Promise<void> {
  await syncConfiguredAdmins();
  const server = app.listen(config.port, config.host, () => {
    logger.info({ host: config.host, port: config.port }, 'server listening');
  });

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

void start().catch(async (error: unknown) => {
  logger.fatal({ err: error }, 'server startup failed');
  await pool.end();
  process.exit(1);
});
