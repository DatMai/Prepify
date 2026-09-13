import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { VaultError, dateInTimeZone, type ObsidianVault } from '../services/obsidianVault';
import type { SyncRepository } from '../modules/journey/syncRepository';
import type {
  JourneyMutationPayload,
  JourneyQuery,
  SyncState,
  SyncStatus,
} from '../modules/journey/syncTypes';

interface JourneyRouterCommonDependencies {
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
  ownerEmail?: string;
}

/** Explicit local trusted mode keeps the vault adapter and the loopback guard. */
export interface LocalJourneyDependencies extends JourneyRouterCommonDependencies {
  mode: 'local';
  vault: ObsidianVault;
}

/**
 * Hosted mode reads stored projections and enqueues canonical structured
 * mutations. It never receives a filesystem path, never accepts raw Markdown,
 * and never touches `ObsidianVault`.
 */
export interface HostedJourneyDependencies extends JourneyRouterCommonDependencies {
  mode: 'hosted';
  sync: SyncRepository;
  query: JourneyQuery;
  vaultId: string;
  timeZone?: string;
  /** Bridge notification hook. A missing or failing notifier never fails a route. */
  notifyOwner?: (ownerId: string) => void | Promise<void>;
  /** Current bridge connectivity for an owner; defaults to disconnected. */
  isBridgeConnected?: (ownerId: string) => boolean;
}

export type JourneyRouterDependencies = LocalJourneyDependencies | HostedJourneyDependencies;

const DEFAULT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const SHA_256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SyncJobStatusRow extends Record<string, unknown> {
  id: string;
  state: SyncState;
  created_at: string | Date;
  completed_at: string | Date | null;
}

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

function requireVaultOwner(ownerEmail: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
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
  };
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

function localExpectedRevision(req: Request): string {
  const value = req.header('if-match');
  if (!value) throw new VaultError(428, 'revision_required', 'If-Match revision is required');
  const normalized = value.replace(/^W\//, '').replace(/^"|"$/g, '');
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) {
    throw new VaultError(400, 'revision_invalid', 'If-Match revision is invalid');
  }
  return normalized;
}

/** Hosted projections store a bare SHA-256 revision; accept the prefixed form too. */
function hostedExpectedRevision(req: Request): string {
  const value = req.header('if-match');
  if (!value) throw new VaultError(428, 'revision_required', 'If-Match revision is required');
  const normalized = value
    .replace(/^W\//, '')
    .replace(/^"|"$/g, '')
    .replace(/^sha256:/, '');
  if (!SHA_256.test(normalized)) {
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

function requestBody(req: Request): Record<string, unknown> {
  const value = req.body as unknown;
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new VaultError(400, 'invalid_request', 'Request body must be an object');
  }
  return value as Record<string, unknown>;
}

/** Hosted requests may only carry the explicit structured fields of the route. */
function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new VaultError(400, 'invalid_request', 'Request body contains unsupported fields');
  }
}

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function createLocalRouter(deps: LocalJourneyDependencies): Router {
  const router = Router();
  router.use(
    requireLocalRequest,
    deps.requireAuth,
    deps.requireAdmin,
    requireVaultOwner(deps.ownerEmail),
  );

  router.get(
    '/today',
    asyncRoute(async (_req, res) => {
      res.json(await deps.vault.getTodayJourney());
    }),
  );

  router.patch(
    '/today/tasks/:taskId',
    asyncRoute(async (req, res) => {
      const { completed, evidence } = requestBody(req) as {
        completed?: unknown;
        evidence?: unknown;
      };
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
        await deps.vault.updateTodayTask({
          taskId,
          completed,
          evidence,
          expectedRevision: localExpectedRevision(req),
          eventId: id,
        }),
      );
    }),
  );

  router.put(
    '/today/journal',
    asyncRoute(async (req, res) => {
      const { done, blocked, next } = requestBody(req);
      if (typeof done !== 'string' || typeof blocked !== 'string' || typeof next !== 'string') {
        throw new VaultError(400, 'invalid_request', 'done, blocked and next must be text');
      }

      res.json(
        await deps.vault.saveTodayJournal({ done, blocked, next }, localExpectedRevision(req)),
      );
    }),
  );

  router.post(
    '/today/evidence',
    asyncRoute(async (req, res) => {
      const { evidence } = requestBody(req);
      if (typeof evidence !== 'string') {
        throw new VaultError(400, 'invalid_request', 'evidence must be text');
      }

      res.json(
        await deps.vault.addTodayEvidence({
          evidence,
          expectedRevision: localExpectedRevision(req),
          eventId: eventId(req),
        }),
      );
    }),
  );

  return router;
}

function createHostedRouter(deps: HostedJourneyDependencies): Router {
  const router = Router();
  const today = (): string => dateInTimeZone(new Date(), deps.timeZone ?? DEFAULT_TIME_ZONE);

  async function notify(ownerId: string): Promise<void> {
    if (!deps.notifyOwner) return;
    try {
      await deps.notifyOwner(ownerId);
    } catch {
      // Notification is best-effort: the durable job already exists.
    }
  }

  async function enqueueMutation(req: Request, payload: JourneyMutationPayload) {
    const ownerId = req.user!.userId;
    const job = await deps.sync.enqueueMutation({
      ownerId,
      vaultId: deps.vaultId,
      idempotencyKey: eventId(req),
      operation: 'journey_mutation',
      payload,
      expectedRevision: hostedExpectedRevision(req),
    });
    await notify(ownerId);
    return job;
  }

  router.use(deps.requireAuth, deps.requireAdmin, requireVaultOwner(deps.ownerEmail));

  router.post(
    '/sync',
    asyncRoute(async (req, res) => {
      assertOnlyKeys(requestBody(req), []);
      const ownerId = req.user!.userId;
      const job = await deps.sync.requestSync({
        ownerId,
        vaultId: deps.vaultId,
        idempotencyKey: eventId(req),
      });
      await notify(ownerId);
      res.status(202).json({ jobId: job.jobId, state: job.state });
    }),
  );

  router.get(
    '/sync/:jobId',
    asyncRoute(async (req, res) => {
      const jobId = req.params.jobId;
      if (typeof jobId !== 'string' || !UUID.test(jobId)) {
        throw new VaultError(404, 'job_not_found', 'Sync job not found');
      }
      const ownerId = req.user!.userId;
      const { rows } = await deps.query<SyncJobStatusRow>(
        `SELECT id, state, created_at, completed_at
           FROM journey_sync_jobs
          WHERE owner_id = $1 AND id = $2::uuid`,
        [ownerId, jobId],
      );
      const row = rows[0];
      if (!row) throw new VaultError(404, 'job_not_found', 'Sync job not found');

      const status: SyncStatus = {
        jobId: row.id,
        state: row.state,
        requestedAt: toIso(row.created_at)!,
        completedAt: toIso(row.completed_at),
        bridgeConnected: deps.isBridgeConnected?.(ownerId) ?? false,
      };
      res.json(status);
    }),
  );

  router.get(
    '/today',
    asyncRoute(async (req, res) => {
      const ownerId = req.user!.userId;
      const projection = await deps.sync.getProjection({ ownerId, vaultId: deps.vaultId });
      if (!projection) {
        res.json({ synced: false });
        return;
      }
      res.json({
        synced: true,
        date: projection.projection.daily.date,
        revision: projection.revision,
        projection: projection.projection,
      });
    }),
  );

  router.patch(
    '/today/tasks/:taskId',
    asyncRoute(async (req, res) => {
      const value = requestBody(req);
      assertOnlyKeys(value, ['completed', 'evidence']);
      const { completed, evidence } = value as { completed?: unknown; evidence?: unknown };
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

      const job = await enqueueMutation(req, {
        kind: 'task',
        date: today(),
        taskId,
        completed,
        ...(typeof evidence === 'string' ? { evidence } : {}),
      });
      res.status(202).json({ jobId: job.jobId, state: job.state });
    }),
  );

  router.put(
    '/today/journal',
    asyncRoute(async (req, res) => {
      const value = requestBody(req);
      assertOnlyKeys(value, ['done', 'blocked', 'next']);
      const { done, blocked, next } = value;
      if (typeof done !== 'string' || typeof blocked !== 'string' || typeof next !== 'string') {
        throw new VaultError(400, 'invalid_request', 'done, blocked and next must be text');
      }

      const job = await enqueueMutation(req, {
        kind: 'journal',
        date: today(),
        done,
        blocked,
        next,
      });
      res.status(202).json({ jobId: job.jobId, state: job.state });
    }),
  );

  router.post(
    '/today/evidence',
    asyncRoute(async (req, res) => {
      const value = requestBody(req);
      assertOnlyKeys(value, ['evidence']);
      const { evidence } = value;
      if (typeof evidence !== 'string') {
        throw new VaultError(400, 'invalid_request', 'evidence must be text');
      }

      const job = await enqueueMutation(req, { kind: 'evidence', date: today(), evidence });
      res.status(202).json({ jobId: job.jobId, state: job.state });
    }),
  );

  return router;
}

export function createJourneyRouter(deps: JourneyRouterDependencies): Router {
  const router = deps.mode === 'local' ? createLocalRouter(deps) : createHostedRouter(deps);

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof VaultError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    next(error);
  });

  return router;
}
