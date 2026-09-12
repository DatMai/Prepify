import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

export interface RecoveryRouteService {
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<void>;
  requestEmailVerification(userId: string): Promise<void>;
  verifyEmail(token: string): Promise<boolean>;
}

interface RecoveryRouteDependencies {
  service: RecoveryRouteService;
  frontendUrl: string;
  requireAuth: RequestHandler;
  rateLimit?: boolean;
}

function noLimit(_req: unknown, _res: unknown, next: () => void): void {
  next();
}

export function createRecoveryRoutes({
  service,
  frontendUrl,
  requireAuth,
  rateLimit: enableRateLimit = true,
}: RecoveryRouteDependencies): Router {
  const router = Router();
  const sensitiveLimit: RequestHandler = enableRateLimit
    ? rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 5,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
      })
    : noLimit;

  router.post('/forgot/email', sensitiveLimit, async (req, res, next) => {
    const parsed = z.object({ email: z.string().trim().email().max(255) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A valid email is required', code: 'invalid_request' });
      return;
    }
    try {
      await service.requestPasswordReset(parsed.data.email);
      res.json({ ok: true, message: 'If the email exists, a reset link has been sent.' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/reset-password', sensitiveLimit, async (req, res, next) => {
    const parsed = z
      .object({ token: z.string().min(20).max(512), newPassword: z.string().min(1).max(1024) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid reset request', code: 'invalid_reset_token' });
      return;
    }
    try {
      await service.resetPassword(parsed.data.token, parsed.data.newPassword);
      res.json({ ok: true });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'invalid_reset_token' || code === 'weak_password') {
        res.status(400).json({
          error:
            code === 'weak_password'
              ? 'Password does not meet requirements'
              : 'Reset link is invalid or expired',
          code,
        });
        return;
      }
      next(error);
    }
  });

  router.post('/resend-verification', requireAuth, sensitiveLimit, async (req, res, next) => {
    try {
      await service.requestEmailVerification(req.user!.userId);
      res.json({ ok: true });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'email_already_verified') {
        res.status(400).json({ error: 'Email is already verified', code });
        return;
      }
      next(error);
    }
  });

  router.get('/verify-email/:token', async (req, res, next) => {
    try {
      const verified = await service.verifyEmail(req.params.token);
      res.redirect(`${frontendUrl}/?email_verified=${verified ? '1' : '0'}`);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
