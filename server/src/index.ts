import path from 'node:path';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import type { Express, RequestHandler } from 'express';
import pino from 'pino';
import { createApp } from './app';
import { loadConfig } from './config/env';
import { createPool, initializeDatabase } from './db/client';
import { createLogger } from './platform/logger/createLogger';
import { startServer } from './platform/server/startServer';
import { initializeAuthMiddleware, requireAuth } from './middleware/auth';
import { requireAdmin } from './middleware/admin';
import { createOptionalSessionAuth, createSessionAuth } from './modules/identity/sessionAuth';
import { createSessionRepository, type SessionQuery } from './modules/identity/sessionRepository';
import { createAuthRoutes } from './modules/identity/authRoutes';
import { createAuthService, defaultAuthServiceDependencies } from './modules/identity/authService';
import { createUserRepository } from './modules/identity/userRepository';
import { createRecoveryStore } from './modules/identity/recoveryRepository';
import { createRecoveryRoutes } from './modules/identity/recoveryRoutes';
import { createRecoveryService } from './modules/identity/recoveryService';
import { createOAuthAccountStore } from './modules/identity/oauthAccountRepository';
import { createOAuthAccountService } from './modules/identity/oauthAccountService';
import { createOAuthFlowStore } from './modules/identity/oauthFlowStore';
import { createOAuthRoutes } from './modules/identity/oauthRoutes';
import { createDailyRouter, type DailyQuery } from './routes/daily';
import journeyRouter from './routes/journey';
import leaderboardRouter from './routes/leaderboard';
import libraryRouter from './routes/library';
import progressRouter from './routes/progress';
import quizSessionsRouter from './routes/quizSessions';
import streakRouter from './routes/streak';
import { recordStudyDay } from './routes/streak';
import { syncConfiguredAdmins } from './services/adminBootstrap';
import { sendPasswordResetEmail, sendVerificationEmail } from './utils/email';

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true, quiet: true });

function registerRoutes(
  app: Express,
  identity: {
    authRoutes: ReturnType<typeof createAuthRoutes>;
    recoveryRoutes: ReturnType<typeof createRecoveryRoutes>;
    oauthRoutes: ReturnType<typeof createOAuthRoutes>;
    optionalAuth: RequestHandler;
    dailyRoutes: ReturnType<typeof createDailyRouter>;
  },
): void {
  app.use('/auth', identity.authRoutes);
  app.use('/auth', identity.recoveryRoutes);
  app.use('/auth', identity.oauthRoutes);
  app.use('/progress', progressRouter);
  app.use('/streak', streakRouter);
  app.use('/leaderboard', identity.optionalAuth, leaderboardRouter);
  app.use('/quiz-sessions', quizSessionsRouter);
  app.use('/daily', identity.dailyRoutes);
  app.use('/journey', journeyRouter);
  app.use('/library', libraryRouter);
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config);
  const pool = createPool(config.databaseUrl, logger);
  initializeDatabase(pool);
  const sessionRepository = createSessionRepository(pool as unknown as SessionQuery);
  const userRepository = createUserRepository(pool as unknown as SessionQuery);
  const authService = createAuthService({
    users: userRepository,
    sessions: sessionRepository,
    ...defaultAuthServiceDependencies(),
    sessionTtlMs: config.session.ttlHours * 60 * 60 * 1000,
  });
  const recoveryService = createRecoveryService({
    store: createRecoveryStore(pool as unknown as SessionQuery),
    passwords: defaultAuthServiceDependencies().passwords,
    randomToken: () => randomBytes(32).toString('base64url'),
    now: () => new Date(),
    frontendUrl: config.frontendUrl,
    callbackBaseUrl: config.publicApiUrl,
    sendPasswordReset: sendPasswordResetEmail,
    sendVerification: sendVerificationEmail,
  });
  const oauthAccountService = createOAuthAccountService(
    createOAuthAccountStore(pool as unknown as SessionQuery),
  );
  const oauthRoutes = createOAuthRoutes({
    config,
    accountService: oauthAccountService,
    sessions: sessionRepository,
    flows: {
      google: createOAuthFlowStore(
        pool as unknown as SessionQuery,
        'google',
        () => randomBytes(32).toString('base64url'),
        () => new Date(),
      ),
      facebook: createOAuthFlowStore(
        pool as unknown as SessionQuery,
        'facebook',
        () => randomBytes(32).toString('base64url'),
        () => new Date(),
      ),
    },
  });
  const dailyRoutes = createDailyRouter({
    query: pool.query.bind(pool) as unknown as DailyQuery,
    requireAuth,
    requireAdmin,
    secret: config.sessionSecret,
    timeZone: config.timeZone,
    contentDir: path.resolve(__dirname, '../..', 'content'),
    recordStudyDay: async (userId) => recordStudyDay(userId, pool),
  });
  initializeAuthMiddleware(createSessionAuth(sessionRepository, config.session.cookieName));

  try {
    await syncConfiguredAdmins();
    const app = createApp({
      config,
      logger,
      registerRoutes: (app) =>
        registerRoutes(app, {
          authRoutes: createAuthRoutes({
            service: authService,
            cookie: {
              name: config.session.cookieName,
              secure: config.session.secure,
              maxAgeMs: config.session.ttlHours * 60 * 60 * 1000,
            },
            requireAuth,
            afterRegister: recoveryService.requestEmailVerification,
          }),
          recoveryRoutes: createRecoveryRoutes({
            service: recoveryService,
            frontendUrl: config.frontendUrl,
            requireAuth,
          }),
          oauthRoutes,
          optionalAuth: createOptionalSessionAuth(sessionRepository, config.session.cookieName),
          dailyRoutes,
        }),
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
