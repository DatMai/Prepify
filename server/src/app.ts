import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import passport from 'passport';
import type { Logger } from 'pino';
import pinoHttp from 'pino-http';
import type { AppConfig } from './config/env';
import { errorHandler, notFound } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  registerRoutes(app: Express): void;
}

export function createApp({ config, logger, registerRoutes }: AppDependencies): Express {
  const app = express();
  const allowedOrigins = new Set(config.corsOrigins);

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      customProps: (_req, res) => ({ requestId: res.locals.requestId }),
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Origin is not allowed by CORS'));
      },
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(passport.initialize());

  registerRoutes(app);

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(notFound());
  app.use(errorHandler(logger));

  return app;
}
