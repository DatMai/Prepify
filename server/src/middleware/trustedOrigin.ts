import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface TrustedOriginOptions {
  /**
   * Route prefixes exempt from the Origin check.
   *
   * Only pass prefixes here for endpoints that authenticate with a non-ambient
   * credential — a bearer token a browser never holds automatically. That is
   * what makes the CSRF this guard defends against impossible on those routes.
   * The local Obsidian bridge is exactly such a client: it is not a browser and
   * deliberately sends no Origin header, so requiring one would reject every
   * claim, projection, completion, conflict and failure it makes.
   */
  exemptPrefixes?: readonly string[];
}

function isExempt(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function trustedOrigin(allowedOrigins: string[], options: TrustedOriginOptions = {}) {
  const allowed = new Set(allowedOrigins);
  const exemptPrefixes = options.exemptPrefixes ?? [];

  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    if (exemptPrefixes.length > 0 && isExempt(req.path, exemptPrefixes)) {
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
