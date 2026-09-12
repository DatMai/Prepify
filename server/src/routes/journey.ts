import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import {
  VaultError,
  addTodayEvidence,
  getTodayJourney,
  saveTodayJournal,
  updateTodayTask,
} from '../services/obsidianVault';

const router = Router();

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function requireLocalRequest(req: Request, res: Response, next: NextFunction): void {
  if (!isLoopback(req.socket.remoteAddress)) {
    res.status(403).json({ error: 'Obsidian sync is local-only', code: 'local_only' });
    return;
  }
  next();
}

function requireVaultOwner(req: Request, res: Response, next: NextFunction): void {
  const ownerEmail = process.env.OBSIDIAN_OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) {
    res.status(503).json({
      error: 'OBSIDIAN_OWNER_EMAIL is not configured',
      code: 'vault_owner_not_configured',
    });
    return;
  }
  if (req.user?.email.toLowerCase() !== ownerEmail) {
    res
      .status(403)
      .json({ error: 'This account does not own the configured vault', code: 'not_vault_owner' });
    return;
  }
  next();
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

function expectedRevision(req: Request): string {
  const value = req.header('if-match');
  if (!value) throw new VaultError(428, 'revision_required', 'If-Match revision is required');
  const normalized = value.replace(/^W\//, '').replace(/^"|"$/g, '');
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) {
    throw new VaultError(400, 'revision_invalid', 'If-Match revision is invalid');
  }
  return normalized;
}

function eventId(req: Request): string {
  const value = req.header('idempotency-key');
  if (!value) throw new VaultError(428, 'idempotency_required', 'Idempotency-Key is required');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
    throw new VaultError(400, 'idempotency_invalid', 'Idempotency-Key is invalid');
  }
  return value;
}

router.use(requireLocalRequest, requireAuth, requireAdmin, requireVaultOwner);

router.get(
  '/today',
  asyncRoute(async (_req, res) => {
    res.json(await getTodayJourney());
  }),
);

router.patch(
  '/today/tasks/:taskId',
  asyncRoute(async (req, res) => {
    const { completed, evidence } = (req.body ?? {}) as { completed?: unknown; evidence?: unknown };
    if (
      typeof completed !== 'boolean' ||
      (evidence !== undefined && typeof evidence !== 'string')
    ) {
      throw new VaultError(
        400,
        'invalid_request',
        'completed must be boolean and evidence must be text',
      );
    }
    const taskId = req.params.taskId;
    if (typeof taskId !== 'string') {
      throw new VaultError(400, 'invalid_request', 'taskId must be text');
    }

    const id = eventId(req);
    res.json(
      await updateTodayTask({
        taskId,
        completed,
        evidence,
        expectedRevision: expectedRevision(req),
        eventId: id,
      }),
    );
  }),
);

router.put(
  '/today/journal',
  asyncRoute(async (req, res) => {
    const { done, blocked, next } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof done !== 'string' || typeof blocked !== 'string' || typeof next !== 'string') {
      throw new VaultError(400, 'invalid_request', 'done, blocked and next must be text');
    }

    res.json(await saveTodayJournal({ done, blocked, next }, expectedRevision(req)));
  }),
);

router.post(
  '/today/evidence',
  asyncRoute(async (req, res) => {
    const { evidence } = (req.body ?? {}) as { evidence?: unknown };
    if (typeof evidence !== 'string') {
      throw new VaultError(400, 'invalid_request', 'evidence must be text');
    }

    res.json(
      await addTodayEvidence({
        evidence,
        expectedRevision: expectedRevision(req),
        eventId: eventId(req),
      }),
    );
  }),
);

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof VaultError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  next(error);
});

export default router;
