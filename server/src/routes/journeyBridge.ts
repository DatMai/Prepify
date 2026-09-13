import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { BridgeAuthenticate } from '../modules/journey/bridgeHub';
import type { SyncRepository } from '../modules/journey/syncRepository';
import type { JourneyProjectionData, SyncJob } from '../modules/journey/syncTypes';

/**
 * The HTTP half of the bridge contract. It consumes the same bearer
 * authenticator as the WebSocket hub (`createBridgeAuthenticator`) and the
 * durable `SyncRepository`, and it only ever accepts structured data and
 * identifiers — never vault paths or arbitrary Markdown.
 */
export interface JourneyBridgeDependencies {
  /** Task 3's bearer authenticator. Resolves the vault owner or null. */
  authenticate: BridgeAuthenticate;
  sync: SyncRepository;
  /** The single hosted vault identity; the bridge may not target another. */
  vaultId: string;
}

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_VAULT_ID = /^[a-z][a-z0-9_-]{2,63}$/;
const SAFE_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REVISION_CONFLICT = 'revision_conflict';

/** How long a claim may be held, in seconds. Matches the repository contract. */
const MIN_LEASE_SECONDS = 1;
const MAX_LEASE_SECONDS = 300;

/**
 * Mirrors `journey_json_is_safe_text` in migration 013. The database remains
 * the final guard; this makes the route reject the same class of payload with a
 * 400 instead of surfacing a repository error.
 */
const UNSAFE_TEXT = [
  /[\r\n]/,
  /[`\\[\]*<>]/,
  /(^|\s)[-+]\s/,
  /(^|\s)[0-9]+\.\s/,
  /(^|\s)#{1,6}\s/,
  /(^|\s)\/?[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+($|\s)/,
  /%[0-9a-fA-F]{2}/,
  /^[a-z][a-z0-9+.-]*:\/\//i,
];

function isSafeText(value: string, maximum: number): boolean {
  return (
    value.length <= maximum &&
    !value.includes('\0') &&
    !UNSAFE_TEXT.some((pattern) => pattern.test(value))
  );
}

/** Mirrors `journey_json_is_tag` in migration 013. */
const TAG = /^#[^#/\\*`<>\s]{1,80}$/;

/**
 * Revisions cross the wire in the canonical `sha256:<64 hex>` form and are
 * normalized to the bare lowercase hash the repository stores.
 */
const REVISION = /^sha256:[a-f0-9]{64}$/;
const revision = z
  .string()
  .regex(REVISION, 'revision must be a sha256: hash')
  .transform((value) => value.slice('sha256:'.length));

const leaseId = z.string().regex(SAFE_IDENTIFIER, 'leaseId must be a safe identifier');

/**
 * Structured field identifiers, relative to the daily projection (for example
 * `journal.done`, `tasks[0].text`). Advisory conflict metadata asserted by the
 * bridge; the server does not compute the diff. The grammar rejects anything
 * that could smuggle a path, a URI, whitespace, or note body text.
 */
const FIELD_NAMES = new Set([
  'daily',
  'date',
  'stage',
  'tasks',
  'evidence',
  'journal',
  'done',
  'blocked',
  'next',
  'id',
  'checked',
  'text',
  'tags',
]);
const FIELD_SEGMENT = /^[a-z][a-z0-9_]*(\[[0-9]{1,6}\])?$/;
const MAX_FIELD_LENGTH = 200;
const MAX_FIELDS = 64;

function isFieldIdentifier(value: string): boolean {
  if (value.length === 0 || value.length > MAX_FIELD_LENGTH) return false;
  return value.split('.').every((segment) => {
    if (!FIELD_SEGMENT.test(segment)) return false;
    return FIELD_NAMES.has(segment.replace(/\[[0-9]+\]$/, ''));
  });
}

const fieldIdentifier = z
  .string()
  .max(MAX_FIELD_LENGTH)
  .refine(isFieldIdentifier, 'field must be a structured field identifier');
const fieldsSchema = z.array(fieldIdentifier).max(MAX_FIELDS);

const taskSchema = z
  .object({
    id: z.string().regex(SAFE_IDENTIFIER, 'task id must be a safe identifier'),
    checked: z.boolean(),
    text: z.string().refine((value) => isSafeText(value, 1_000), 'task text must be safe text'),
    tags: z.array(z.string().regex(TAG, 'tag must be a safe tag')).max(32),
  })
  .strict();

const projectionSchema = z
  .object({
    daily: z
      .object({
        date: z.string().regex(ISO_DATE, 'date must be an ISO calendar date'),
        stage: z
          .string()
          .refine((value) => isSafeText(value, 160), 'stage must be safe text'),
        tasks: z.array(taskSchema).max(200),
        evidence: z
          .array(z.string().refine((value) => isSafeText(value, 1_000), 'evidence must be safe text'))
          .max(100),
        journal: z
          .object({
            done: z.string().refine((value) => isSafeText(value, 5_000), 'done must be safe text'),
            blocked: z
              .string()
              .refine((value) => isSafeText(value, 5_000), 'blocked must be safe text'),
            next: z.string().refine((value) => isSafeText(value, 5_000), 'next must be safe text'),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const claimBody = z
  .object({
    leaseId,
    leaseSeconds: z.number().int().min(MIN_LEASE_SECONDS).max(MAX_LEASE_SECONDS),
  })
  .strict();

const projectionBody = z
  .object({
    vaultId: z.string().regex(SAFE_VAULT_ID, 'vaultId must be a safe identifier'),
    leaseId,
    /** Null is valid only for the first projection for a vault. */
    expectedRevision: revision.nullable(),
    revision,
    projection: projectionSchema,
    fields: fieldsSchema.optional(),
  })
  .strict();

const completeBody = z
  .object({
    leaseId,
    revision,
    projection: projectionSchema,
  })
  .strict();

const conflictBody = z
  .object({
    leaseId,
    expectedRevision: revision,
    actualRevision: revision,
    fields: fieldsSchema.optional(),
  })
  .strict();

const failBody = z
  .object({
    leaseId,
    errorCode: z
      .string()
      .regex(SAFE_ERROR_CODE, 'errorCode must be a sanitized error code')
      .refine((code) => code !== REVISION_CONFLICT, 'use the conflict route for revision conflicts'),
    expectedRevision: revision.optional(),
    actualRevision: revision.optional(),
  })
  .strict();

type Json = Record<string, unknown>;

function requestBody(req: Request): unknown {
  const value = req.body as unknown;
  return value === undefined ? {} : value;
}

function invalid(res: Response, message: string): void {
  res.status(400).json({ error: message, code: 'invalid_request' });
}

/**
 * Revisions cross the wire in the canonical `sha256:<64 hex>` form. The
 * repository stores bare hex, so every outbound revision is re-prefixed here.
 */
function outboundRevision(value: string | null): string | null {
  if (value === null) return null;
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}

/** Only structured data and identifiers are ever returned to the bridge. */
function jobView(job: SyncJob): Json {
  return {
    jobId: job.jobId,
    vaultId: job.vaultId,
    type: job.type,
    payload: job.payload,
    idempotencyKey: job.idempotencyKey,
    expectedRevision: outboundRevision(job.expectedRevision),
    state: job.state,
    leaseId: job.leaseId,
    leaseExpiresAt: job.leaseExpiresAt,
    attemptCount: job.attemptCount,
    requestedAt: job.requestedAt,
    completedAt: job.completedAt,
    failureCode: job.failureCode,
    conflictExpectedRevision: outboundRevision(job.conflictExpectedRevision),
    conflictActualRevision: outboundRevision(job.conflictActualRevision),
  };
}

function conflictResponse(res: Response, job: SyncJob, fields?: string[]): void {
  res.status(409).json({
    error: 'The note changed since the job was created',
    code: REVISION_CONFLICT,
    expectedRevision: outboundRevision(job.conflictExpectedRevision),
    actualRevision: outboundRevision(job.conflictActualRevision),
    ...(fields !== undefined ? { fields } : {}),
  });
}

function notFound(res: Response): void {
  res.status(404).json({ error: 'Sync job not found', code: 'job_not_found' });
}

function ownerId(res: Response): string {
  return String(res.locals.bridgeOwnerId);
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: (error: unknown) => void) => void {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

/**
 * Authenticates the request with the bridge bearer credential only. A browser
 * session cookie (and any `req.user` it sets) is never consulted.
 */
function requireBridgeOwner(authenticate: BridgeAuthenticate): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve()
      .then(() => authenticate(req))
      .then((owner) => {
        if (!owner) {
          res
            .status(401)
            .json({ error: 'Bridge credential required', code: 'bridge_unauthenticated' });
          return;
        }
        res.locals.bridgeOwnerId = owner;
        next();
      })
      .catch(next);
  };
}

export function createJourneyBridgeRouter(deps: JourneyBridgeDependencies): Router {
  const router = Router();
  router.use(requireBridgeOwner(deps.authenticate));

  function jobIdOf(req: Request, res: Response): string | null {
    const value = req.params.id;
    if (typeof value !== 'string' || !JOB_ID.test(value)) {
      invalid(res, 'id must be a job identifier');
      return null;
    }
    return value;
  }

  router.get(
    '/pending',
    asyncRoute(async (_req, res) => {
      const jobs = await deps.sync.listPending({ ownerId: ownerId(res), vaultId: deps.vaultId });
      res.json({ jobs: jobs.map(jobView) });
    }),
  );

  router.post(
    '/:id/claim',
    asyncRoute(async (req, res) => {
      const jobId = jobIdOf(req, res);
      if (!jobId) return;
      const parsed = claimBody.safeParse(requestBody(req));
      if (!parsed.success) {
        invalid(res, 'leaseId and leaseSeconds are required');
        return;
      }
      const job = await deps.sync.claim({ ownerId: ownerId(res), jobId, ...parsed.data });
      if (!job) {
        res.status(409).json({ error: 'Sync job is not claimable', code: 'job_not_claimable' });
        return;
      }
      res.json({ job: jobView(job) });
    }),
  );

  router.post(
    '/:id/projection',
    asyncRoute(async (req, res) => {
      const jobId = jobIdOf(req, res);
      if (!jobId) return;
      const parsed = projectionBody.safeParse(requestBody(req));
      if (!parsed.success) {
        invalid(res, 'a structured projection with safe revisions is required');
        return;
      }
      const { vaultId, leaseId: lease, expectedRevision, revision: next, projection, fields } =
        parsed.data;
      if (vaultId !== deps.vaultId) {
        invalid(res, 'vaultId does not match this bridge vault');
        return;
      }
      const job = await deps.sync.recordInboundProjection({
        ownerId: ownerId(res),
        vaultId,
        jobId,
        leaseId: lease,
        expectedRevision,
        revision: next,
        projection: projection as JourneyProjectionData,
      });
      if (!job) {
        notFound(res);
        return;
      }
      if (job.state === 'conflict') {
        conflictResponse(res, job, fields);
        return;
      }
      res.json({ job: jobView(job) });
    }),
  );

  router.post(
    '/:id/complete',
    asyncRoute(async (req, res) => {
      const jobId = jobIdOf(req, res);
      if (!jobId) return;
      const parsed = completeBody.safeParse(requestBody(req));
      if (!parsed.success) {
        invalid(res, 'a structured projection with a safe revision is required');
        return;
      }
      const job = await deps.sync.complete({
        ownerId: ownerId(res),
        jobId,
        leaseId: parsed.data.leaseId,
        revision: parsed.data.revision,
        projection: parsed.data.projection as JourneyProjectionData,
      });
      if (!job) {
        notFound(res);
        return;
      }
      if (job.state === 'conflict') {
        conflictResponse(res, job);
        return;
      }
      res.json({ job: jobView(job) });
    }),
  );

  router.post(
    '/:id/conflict',
    asyncRoute(async (req, res) => {
      const jobId = jobIdOf(req, res);
      if (!jobId) return;
      const parsed = conflictBody.safeParse(requestBody(req));
      if (!parsed.success) {
        invalid(res, 'expectedRevision and actualRevision are required');
        return;
      }
      const job = await deps.sync.fail({
        ownerId: ownerId(res),
        jobId,
        leaseId: parsed.data.leaseId,
        state: 'conflict',
        errorCode: REVISION_CONFLICT,
        expectedRevision: parsed.data.expectedRevision,
        actualRevision: parsed.data.actualRevision,
      });
      if (!job) {
        notFound(res);
        return;
      }
      conflictResponse(res, job, parsed.data.fields);
    }),
  );

  router.post(
    '/:id/fail',
    asyncRoute(async (req, res) => {
      const jobId = jobIdOf(req, res);
      if (!jobId) return;
      const parsed = failBody.safeParse(requestBody(req));
      if (!parsed.success) {
        invalid(res, 'a sanitized errorCode is required');
        return;
      }
      const job = await deps.sync.fail({
        ownerId: ownerId(res),
        jobId,
        leaseId: parsed.data.leaseId,
        state: 'failed',
        errorCode: parsed.data.errorCode,
        expectedRevision: parsed.data.expectedRevision,
        actualRevision: parsed.data.actualRevision,
      });
      if (!job) {
        notFound(res);
        return;
      }
      res.json({ job: jobView(job) });
    }),
  );

  return router;
}
