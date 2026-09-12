import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { PublicUser } from './sessionRepository';
import { clearSessionCookie, setSessionCookie } from './sessionCookie';

export interface AuthRouteService {
  register(input: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<{ user: PublicUser; token: string }>;
  login(input: { email: string; password: string }): Promise<{ user: PublicUser; token: string }>;
  currentUser(userId: string): Promise<PublicUser>;
  logout(rawToken: string): Promise<void>;
  updateProfile(
    userId: string,
    input: { displayName?: string; location?: string; avatarId?: number },
  ): Promise<PublicUser>;
}

interface AuthRouteDependencies {
  service: AuthRouteService;
  cookie: { name: string; secure: boolean; maxAgeMs: number };
  requireAuth: RequestHandler;
  rateLimit?: boolean;
  afterRegister?(userId: string): Promise<void>;
}

const registerSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(1024),
  displayName: z.string().trim().max(50).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(1024),
});

const profileSchema = z
  .object({
    displayName: z.string().trim().max(50).optional(),
    location: z.string().trim().max(100).optional(),
    avatarId: z.number().int().min(1).max(20).optional(),
  })
  .strict();

function noLimit(_req: unknown, _res: unknown, next: () => void): void {
  next();
}

function publicAuthError(error: unknown): {
  status: number;
  body: { error: string; code: string };
} {
  const code = (error as { code?: string }).code;
  if (code === 'invalid_credentials') {
    return { status: 401, body: { error: 'Unable to sign in', code } };
  }
  if (code === 'email_in_use') {
    return { status: 409, body: { error: 'Email is already in use', code } };
  }
  if (code === 'weak_password') {
    return { status: 400, body: { error: 'Password does not meet requirements', code } };
  }
  if (code === 'account_disabled') {
    return { status: 403, body: { error: 'This account has been disabled', code } };
  }
  throw error;
}

export function createAuthRoutes({
  service,
  cookie,
  requireAuth,
  rateLimit: enableRateLimit = true,
  afterRegister,
}: AuthRouteDependencies): Router {
  const router = Router();
  const sensitiveLimit: RequestHandler = enableRateLimit
    ? rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
      })
    : noLimit;

  router.post('/register', sensitiveLimit, async (req, res, next) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid registration details', code: 'invalid_request' });
      return;
    }
    try {
      const result = await service.register(parsed.data);
      setSessionCookie(res, cookie.name, result.token, cookie.secure, cookie.maxAgeMs);
      res.status(201).json({ user: result.user });
      if (afterRegister) void afterRegister(result.user.id).catch(() => {});
    } catch (error) {
      try {
        const response = publicAuthError(error);
        res.status(response.status).json(response.body);
      } catch (unexpected) {
        next(unexpected);
      }
    }
  });

  router.post('/login', sensitiveLimit, async (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid login details', code: 'invalid_request' });
      return;
    }
    try {
      const result = await service.login(parsed.data);
      setSessionCookie(res, cookie.name, result.token, cookie.secure, cookie.maxAgeMs);
      res.json({ user: result.user });
    } catch (error) {
      try {
        const response = publicAuthError(error);
        res.status(response.status).json(response.body);
      } catch (unexpected) {
        next(unexpected);
      }
    }
  });

  router.get('/session', requireAuth, async (req, res, next) => {
    try {
      res.json({ user: await service.currentUser(req.user!.userId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      res.json(await service.currentUser(req.user!.userId));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/session', requireAuth, async (req, res, next) => {
    try {
      await service.logout(req.authSession!.token);
      clearSessionCookie(res, cookie.name, cookie.secure);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.patch('/profile', requireAuth, async (req, res, next) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid profile details', code: 'invalid_request' });
      return;
    }
    try {
      const updated = await service.updateProfile(req.user!.userId, parsed.data);
      res.json({
        displayName: updated.displayName,
        location: updated.location,
        avatarId: updated.avatarId,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
