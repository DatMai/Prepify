import type { NextFunction, Request, Response } from 'express';
import { readCookie } from './sessionCookie';
import type { SessionRepository } from './sessionRepository';

export function createSessionAuth(repository: SessionRepository, cookieName: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = readCookie(req, cookieName);
    if (!token) {
      res.status(401).json({ error: 'Authentication required', code: 'auth_required' });
      return;
    }

    try {
      const session = await repository.findActive(token);
      if (!session) {
        res.status(401).json({ error: 'Authentication required', code: 'auth_required' });
        return;
      }

      req.user = {
        userId: session.user.id,
        email: session.user.email,
        role: session.user.role,
      };
      req.authSession = { id: session.sessionId, token };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createOptionalSessionAuth(repository: SessionRepository, cookieName: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = readCookie(req, cookieName);
    if (!token) {
      next();
      return;
    }
    try {
      const session = await repository.findActive(token);
      if (session) {
        req.user = {
          userId: session.user.id,
          email: session.user.email,
          role: session.user.role,
        };
        req.authSession = { id: session.sessionId, token };
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
