import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function trustedOrigin(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = req.header('origin');
    if (!origin || !allowed.has(origin)) {
      res.status(403).json({ error: 'Untrusted request origin', code: 'untrusted_origin' });
      return;
    }
    next();
  };
}
