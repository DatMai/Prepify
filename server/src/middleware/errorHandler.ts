import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { AppError } from '../shared/errors/appError';

export function notFound(): RequestHandler {
  return (_req, _res, next) => {
    next(new AppError(404, 'HTTP_NOT_FOUND', 'Resource not found'));
  };
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, _next) => {
    const requestId = String(res.locals.requestId ?? 'unknown');

    if (error instanceof AppError) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      });
      return;
    }

    logger.error({ err: error, requestId }, 'unhandled request error');
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        requestId,
      },
    });
  };
}
