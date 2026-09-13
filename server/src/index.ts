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
import { createJourneyRouter } from './routes/journey';
import { createJourneyBridgeRouter } from './routes/journeyBridge';
import {
  createBridgeAuthenticator,
  createBridgeHub,
  type BridgeAuthenticate,
} from './modules/journey/bridgeHub';
import { createSyncRepository } from './modules/journey/syncRepository';
import type { JourneyQuery, JourneyTransaction } from './modules/journey/syncTypes';
import leaderboardRouter from './routes/leaderboard';
import { createLibraryRouter } from './routes/library';
import { createLibraryAdminRouter } from './routes/libraryAdmin';
import { createLibraryRepository, type LibraryQuery } from './modules/library/libraryRepository';
import { createLibraryAuthoring } from './modules/library/libraryAuthoring';
import progressRouter from './routes/progress';
import { createQuizSessionsRouter, type QuizSessionQuery } from './routes/quizSessions';
import { createStreakRouter, recordStudyDay } from './routes/streak';
import { createFeedRouter } from './routes/feed';
import { createAdminRouter } from './routes/admin';
import { createAdminRepository } from './modules/admin/adminRepository';
import { createFeedService } from './modules/feed/feedService';
import { DEFAULT_FEED_SOURCES } from './modules/feed/sources';
import { createReviewRouter } from './routes/review';
import { createReviewRepository } from './modules/review/reviewRepository';
import { syncConfiguredAdmins } from './services/adminBootstrap';
import { createObsidianVault } from './services/obsidianVault';
import { createMailer } from './utils/email';

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
    journeyRoutes: ReturnType<typeof createJourneyRouter>;
    bridgeRoutes: ReturnType<typeof createJourneyBridgeRouter>;
    streakRoutes: ReturnType<typeof createStreakRouter>;
    feedRoutes: ReturnType<typeof createFeedRouter>;
    adminRoutes: ReturnType<typeof createAdminRouter>;
    reviewRoutes: ReturnType<typeof createReviewRouter>;
    libraryRoutes: ReturnType<typeof createLibraryRouter>;
    libraryAdminRoutes: ReturnType<typeof createLibraryAdminRouter>;
    quizSessionsRoutes: ReturnType<typeof createQuizSessionsRouter>;
  },
): void {
  app.use('/api/v1/auth', identity.authRoutes);
  app.use('/api/v1/auth', identity.recoveryRoutes);
  app.use('/api/v1/auth', identity.oauthRoutes);
  app.use('/api/v1/progress', progressRouter);
  app.use('/api/v1/streak', identity.streakRoutes);
  app.use('/api/v1/feed', identity.feedRoutes);
  app.use('/api/v1/admin', identity.adminRoutes);
  app.use('/api/v1/review', identity.reviewRoutes);
  app.use('/api/v1/leaderboard', identity.optionalAuth, leaderboardRouter);
  app.use('/api/v1/quiz-sessions', identity.quizSessionsRoutes);
  app.use('/api/v1/daily', identity.dailyRoutes);
  // Registered before the Journey reader router: that router applies session
  // and vault-owner middleware to every path beneath it, which a bearer-only
  // bridge request must never traverse.
  app.use('/api/v1/journey/bridge/jobs', identity.bridgeRoutes);
  app.use('/api/v1/journey', identity.journeyRoutes);
  // The admin prefix is registered first so it wins over the reader router.
  app.use('/api/v1/library/admin', identity.libraryAdminRoutes);
  app.use('/api/v1/library', identity.libraryRoutes);
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config);
  if (!config.email.enabled) {
    logger.warn(
      'Email delivery is disabled; verification and password-reset messages will not be sent',
    );
  }
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
  const mailer = createMailer(config.email);
  const recoveryService = createRecoveryService({
    store: createRecoveryStore(pool as unknown as SessionQuery),
    passwords: defaultAuthServiceDependencies().passwords,
    randomToken: () => randomBytes(32).toString('base64url'),
    now: () => new Date(),
    frontendUrl: config.frontendUrl,
    callbackBaseUrl: `${config.publicApiUrl}/api/v1`,
    sendPasswordReset: mailer.sendPasswordReset,
    sendVerification: mailer.sendVerification,
    onEmailError: (error, kind) => logger.error({ err: error, kind }, 'Email delivery failed'),
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
  const libraryRepository = createLibraryRepository({
    query: pool.query.bind(pool) as unknown as LibraryQuery,
  });
  const withTransaction = async <T>(fn: (tx: LibraryQuery) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client.query.bind(client) as unknown as LibraryQuery);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  const libraryAuthoring = createLibraryAuthoring({
    query: pool.query.bind(pool) as unknown as LibraryQuery,
    withTransaction,
  });
  const libraryRoutes = createLibraryRouter({ repo: libraryRepository });
  const libraryAdminRoutes = createLibraryAdminRouter({
    authoring: libraryAuthoring,
    requireAuth,
    requireAdmin,
  });
  const withJourneyTransaction: JourneyTransaction = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client.query.bind(client) as unknown as JourneyQuery);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  const syncRepository = createSyncRepository({
    query: pool.query.bind(pool) as unknown as JourneyQuery,
    withTransaction: withJourneyTransaction,
  });
  // The hub is built before the routers so they can close over its notifier and
  // connectivity seams; it is attached to the HTTP server only after listening.
  const bridgeToken = config.obsidian.bridge.enabled ? config.obsidian.bridge.token : undefined;
  // One authenticator instance is shared by the WebSocket hub and the bridge
  // HTTP contract, so the bearer parsing and constant-time comparison exist in
  // exactly one place. When the bridge is disabled nobody can authenticate.
  const bridgeAuthenticate: BridgeAuthenticate = bridgeToken
    ? createBridgeAuthenticator({
        token: bridgeToken,
        resolveOwnerId: async () => {
          const ownerEmail = config.obsidian.ownerEmail;
          if (!ownerEmail) return null;
          const owner = await userRepository.findByEmail(ownerEmail);
          return owner?.id ?? null;
        },
      })
    : () => null;
  const bridgeHub = createBridgeHub({
    authenticate: bridgeAuthenticate,
    loadPending: async (ownerId) => {
      const jobs = await syncRepository.listPending({
        ownerId,
        vaultId: config.obsidian.vaultId,
      });
      return jobs.map((job) => job.jobId);
    },
    logger,
  });
  const dailyRoutes = createDailyRouter({
    query: pool.query.bind(pool) as unknown as DailyQuery,
    repo: libraryRepository,
    requireAuth,
    requireAdmin,
    secret: config.sessionSecret,
    timeZone: config.timeZone,
    recordStudyDay: async (userId) => recordStudyDay(userId, pool, config.timeZone),
    withTransaction: withJourneyTransaction,
    enqueueDailySummary: async (input, tx) => {
      // Reuse the repository against the Daily transaction so the completion
      // row and its outbox job commit together.
      const scoped = createSyncRepository({
        query: tx as unknown as JourneyQuery,
        withTransaction: (fn) => fn(tx as unknown as JourneyQuery),
      });
      await scoped.enqueueMutation({
        ownerId: input.ownerId,
        vaultId: config.obsidian.vaultId,
        idempotencyKey: input.idempotencyKey,
        operation: 'daily_summary',
        payload: { date: input.date, score: input.score, total: input.total },
      });
    },
  });
  const quizSessionsRoutes = createQuizSessionsRouter({
    query: pool.query.bind(pool) as unknown as QuizSessionQuery,
    requireAuth,
  });
  const streakRoutes = createStreakRouter({ pool, timeZone: config.timeZone });
  const feedRoutes = createFeedRouter({
    service: createFeedService({ sources: DEFAULT_FEED_SOURCES }),
  });
  const adminRoutes = createAdminRouter({
    repo: createAdminRepository({
      query: pool.query.bind(pool) as unknown as Parameters<
        typeof createAdminRepository
      >[0]['query'],
    }),
    requireAuth,
    requireAdmin,
  });
  const reviewRoutes = createReviewRouter({
    repo: createReviewRepository({ query: pool.query.bind(pool) }),
    requireAuth,
    timeZone: config.timeZone,
    recordStudyDay: async (userId) => recordStudyDay(userId, pool, config.timeZone),
  });
  const journeyRoutes = createJourneyRouter(
    config.obsidian.enabled
      ? {
          mode: 'local',
          requireAuth,
          requireAdmin,
          ownerEmail: config.obsidian.ownerEmail,
          vault: createObsidianVault(config.obsidian),
        }
      : {
          mode: 'hosted',
          requireAuth,
          requireAdmin,
          ownerEmail: config.obsidian.ownerEmail,
          sync: syncRepository,
          query: pool.query.bind(pool) as unknown as JourneyQuery,
          vaultId: config.obsidian.vaultId,
          timeZone: config.obsidian.timeZone,
          notifyOwner: (ownerId) => bridgeHub.notifyOwner(ownerId),
          isBridgeConnected: (ownerId) => bridgeHub.isConnected(ownerId),
        },
  );
  const bridgeRoutes = createJourneyBridgeRouter({
    authenticate: bridgeAuthenticate,
    sync: syncRepository,
    vaultId: config.obsidian.vaultId,
  });
  initializeAuthMiddleware(createSessionAuth(sessionRepository, config.session.cookieName));

  try {
    await syncConfiguredAdmins(pool.query.bind(pool), config.adminEmails);
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
          journeyRoutes,
          bridgeRoutes,
          streakRoutes,
          feedRoutes,
          adminRoutes,
          reviewRoutes,
          libraryRoutes,
          libraryAdminRoutes,
          quizSessionsRoutes,
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
      beforeClose: () => bridgeHub.close(),
      closePool: async () => pool.end(),
    });
    // Attach only once the server is listening so upgrade handling starts after
    // the routers already hold the hub's notifier and connectivity seams.
    bridgeHub.attach(runtime.server);

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
