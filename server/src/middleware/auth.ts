import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../modules/identity/sessionRepository';

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void;

/** @deprecated Legacy JWT shape; removed with the leaderboard/OAuth migration. */
export interface AuthPayload {
  userId: string;
  email: string;
}

let configuredMiddleware: AuthMiddleware | undefined;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express exposes this namespace for declaration merging.
  namespace Express {
    // Passport declares Request.user?: User — extend User with our payload fields
    interface User {
      userId: string;
      email: string;
      role?: UserRole;
    }

    interface Request {
      authSession?: {
        id: string;
        token: string;
      };
    }
  }
}

export function initializeAuthMiddleware(middleware: AuthMiddleware): void {
  configuredMiddleware = middleware;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!configuredMiddleware) {
    next(new Error('Authentication middleware has not been initialized'));
    return;
  }
  configuredMiddleware(req, res, next);
}
