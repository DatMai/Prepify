import type {
  ClaimSyncJobInput,
  CompleteSyncJobInput,
  EnqueueMutationInput,
  FailSyncJobInput,
  JourneyProjection,
  JourneyProjectionData,
  JourneyQuery,
  JourneyTransaction,
  RecordInboundProjectionInput,
  RequestSyncInput,
  SyncJob,
  SyncJobPayload,
  SyncJobType,
  SyncState,
} from './syncTypes';

interface ProjectionRow extends Record<string, unknown> {
  owner_id: string;
  vault_id: string;
  revision: string;
  projection: JourneyProjectionData;
  updated_at: string | Date;
}

interface JobRow extends Record<string, unknown> {
  id: string;
  owner_id: string;
  vault_id: string;
  job_type: SyncJobType;
  payload: SyncJobPayload;
  idempotency_key: string;
  expected_revision: string | null;
  state: SyncState;
  lease_id: string | null;
  lease_expires_at: string | Date | null;
  attempt_count: number | string;
  completed_at: string | Date | null;
  failure_code: string | null;
  conflict_expected_revision: string | null;
  conflict_actual_revision: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  created?: boolean;
}

const JOB_COLUMNS = `
  id, owner_id, vault_id, job_type, payload, idempotency_key, expected_revision,
  state, lease_id, lease_expires_at, attempt_count, completed_at, failure_code,
  conflict_expected_revision, conflict_actual_revision, created_at, updated_at`;
const SHA_256 = /^[a-f0-9]{64}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_VAULT_ID = /^[a-z][a-z0-9_-]{2,63}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapJob(row: JobRow): SyncJob {
  return {
    jobId: row.id,
    ownerId: row.owner_id,
    vaultId: row.vault_id,
    type: row.job_type,
    payload: row.payload,
    idempotencyKey: row.idempotency_key,
    expectedRevision: row.expected_revision,
    state: row.state,
    leaseId: row.lease_id,
    leaseExpiresAt: toIso(row.lease_expires_at),
    attemptCount: Number(row.attempt_count),
    requestedAt: toIso(row.created_at)!,
    completedAt: toIso(row.completed_at),
    failureCode: row.failure_code,
    conflictExpectedRevision: row.conflict_expected_revision,
    conflictActualRevision: row.conflict_actual_revision,
  };
}

function mapProjection(row: ProjectionRow): JourneyProjection {
  return {
    ownerId: row.owner_id,
    vaultId: row.vault_id,
    revision: row.revision,
    projection: row.projection,
    updatedAt: toIso(row.updated_at)!,
  };
}

function assertRevision(revision: string): void {
  if (!SHA_256.test(revision)) throw new Error('revision must be a lowercase SHA-256 hash');
}

function assertSafeIdentifier(value: string, field: string): void {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error(`${field} must be a safe identifier`);
}

function assertVaultId(vaultId: string): void {
  if (!SAFE_VAULT_ID.test(vaultId)) throw new Error('vaultId must be a safe identifier');
}

function assertErrorCode(errorCode: string): void {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(errorCode)) {
    throw new Error('errorCode must be a sanitized error code');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.hasOwn(value, key));
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength && !value.includes('\0');
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value);
}

function isIdentifier(value: unknown, maxLength = 128): value is string {
  return typeof value === 'string' && value.length <= maxLength && SAFE_IDENTIFIER.test(value);
}

function isStringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((entry) => isSafeText(entry, maxLength))
  );
}

function assertProjection(projection: unknown): asserts projection is JourneyProjectionData {
  const invalid = (): never => {
    throw new Error('projection must match the allowlisted schema');
  };
  if (
    !isRecord(projection) ||
    !hasKeys(projection, ['daily']) ||
    !hasOnlyKeys(projection, ['daily'])
  )
    invalid();
  const daily = (projection as Record<string, unknown>).daily;
  if (
    !isRecord(daily) ||
    !hasKeys(daily, ['date', 'stage', 'tasks', 'evidence', 'journal']) ||
    !hasOnlyKeys(daily, ['date', 'stage', 'tasks', 'evidence', 'journal']) ||
    !isDate(daily.date) ||
    !isSafeText(daily.stage, 160) ||
    !isStringArray(daily.evidence, 100, 1000) ||
    !isRecord(daily.journal) ||
    !hasKeys(daily.journal, ['done', 'blocked', 'next']) ||
    !hasOnlyKeys(daily.journal, ['done', 'blocked', 'next']) ||
    !isSafeText(daily.journal.done, 5000) ||
    !isSafeText(daily.journal.blocked, 5000) ||
    !isSafeText(daily.journal.next, 5000) ||
    !Array.isArray(daily.tasks) ||
    daily.tasks.length > 200
  ) {
    invalid();
  }
  for (const task of (daily as Record<string, unknown>).tasks as unknown[]) {
    if (
      !isRecord(task) ||
      !hasKeys(task, ['id', 'checked', 'text', 'tags']) ||
      !hasOnlyKeys(task, ['id', 'checked', 'text', 'tags']) ||
      !isIdentifier(task.id) ||
      typeof task.checked !== 'boolean' ||
      !isSafeText(task.text, 1000) ||
      !isStringArray(task.tags, 32, 80)
    ) {
      invalid();
    }
  }
}

function assertMutation(input: EnqueueMutationInput): void {
  const payload = input.payload as unknown;
  if (!isRecord(payload)) throw new Error('payload must match the allowlisted schema');
  if (input.operation === 'daily_summary') {
    if (
      !hasKeys(payload, ['date', 'score', 'total']) ||
      !hasOnlyKeys(payload, ['date', 'score', 'total']) ||
      !isDate(payload.date) ||
      !Number.isInteger(payload.score) ||
      !Number.isInteger(payload.total) ||
      (payload.score as number) < 0 ||
      (payload.total as number) < 1 ||
      (payload.score as number) > (payload.total as number)
    ) {
      throw new Error('payload must match the allowlisted schema');
    }
    return;
  }

  if (!isSafeText(payload.kind, 20) || !isDate(payload.date)) {
    throw new Error('payload must match the allowlisted schema');
  }
  if (payload.kind === 'task') {
    if (
      !hasOnlyKeys(payload, ['kind', 'date', 'taskId', 'completed', 'evidence']) ||
      !isIdentifier(payload.taskId) ||
      typeof payload.completed !== 'boolean' ||
      (payload.evidence !== undefined && !isSafeText(payload.evidence, 1000))
    ) {
      throw new Error('payload must match the allowlisted schema');
    }
    return;
  }
  if (payload.kind === 'journal') {
    if (
      !hasKeys(payload, ['kind', 'date', 'done', 'blocked', 'next']) ||
      !hasOnlyKeys(payload, ['kind', 'date', 'done', 'blocked', 'next']) ||
      !isSafeText(payload.done, 5000) ||
      !isSafeText(payload.blocked, 5000) ||
      !isSafeText(payload.next, 5000)
    ) {
      throw new Error('payload must match the allowlisted schema');
    }
    return;
  }
  if (
    payload.kind !== 'evidence' ||
    !hasKeys(payload, ['kind', 'date', 'evidence']) ||
    !hasOnlyKeys(payload, ['kind', 'date', 'evidence']) ||
    !isSafeText(payload.evidence, 1000)
  ) {
    throw new Error('payload must match the allowlisted schema');
  }
}

function assertRequestIdentifiers(input: RequestSyncInput): void {
  assertSafeIdentifier(input.ownerId, 'ownerId');
  assertVaultId(input.vaultId);
  assertSafeIdentifier(input.idempotencyKey, 'idempotencyKey');
}

function assertJobLease(input: { ownerId: string; jobId: string; leaseId: string }): void {
  assertSafeIdentifier(input.ownerId, 'ownerId');
  assertSafeIdentifier(input.jobId, 'jobId');
  assertSafeIdentifier(input.leaseId, 'leaseId');
}

async function insertAudit(
  query: JourneyQuery,
  input: {
    ownerId: string;
    jobId: string | null;
    eventType: string;
    details: Record<string, string>;
  },
): Promise<void> {
  await query(
    `INSERT INTO journey_audit_events (owner_id, job_id, event_type, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [input.ownerId, input.jobId, input.eventType, JSON.stringify(input.details)],
  );
}

async function saveProjection(
  query: JourneyQuery,
  input: {
    ownerId: string;
    vaultId: string;
    revision: string;
    expectedRevision: string | null;
    projection: JourneyProjectionData;
  },
  options: { unguarded?: boolean } = {},
): Promise<boolean> {
  // A recorded expectation keeps a real compare-and-swap. The complete path
  // only drops the guard when the job recorded no expectation at all: there is
  // no precondition for it to compare against, so the write is an unguarded
  // upsert. Inbound projections always pass the guard.
  const guard = options.unguarded
    ? ''
    : `
       WHERE journey_projections.revision IS NOT DISTINCT FROM $5`;
  const { rows } = await query<{ revision: string }>(
    `INSERT INTO journey_projections (owner_id, vault_id, revision, projection)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (owner_id, vault_id)
     DO UPDATE SET revision = EXCLUDED.revision, projection = EXCLUDED.projection, updated_at = NOW()${guard}
     RETURNING revision`,
    [
      input.ownerId,
      input.vaultId,
      input.revision,
      JSON.stringify(input.projection),
      input.expectedRevision,
    ],
  );
  return rows.length > 0;
}

async function currentRevision(
  query: JourneyQuery,
  ownerId: string,
  vaultId: string,
): Promise<string | null> {
  const { rows } = await query<{ revision: string }>(
    `SELECT revision FROM journey_projections WHERE owner_id = $1 AND vault_id = $2`,
    [ownerId, vaultId],
  );
  return rows[0]?.revision ?? null;
}

export function createSyncRepository(deps: {
  query: JourneyQuery;
  withTransaction: JourneyTransaction;
}) {
  async function createJob(
    tx: JourneyQuery,
    input: RequestSyncInput & {
      type: SyncJobType;
      payload: SyncJobPayload;
      expectedRevision: string | null;
      auditEvent: 'requested' | 'enqueued';
    },
  ): Promise<SyncJob> {
    const { rows } = await tx<JobRow>(
      `INSERT INTO journey_sync_jobs
         (owner_id, vault_id, job_type, payload, idempotency_key, expected_revision)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (owner_id, idempotency_key)
       DO UPDATE SET idempotency_key = journey_sync_jobs.idempotency_key
       RETURNING ${JOB_COLUMNS}, (xmax = 0) AS created`,
      [
        input.ownerId,
        input.vaultId,
        input.type,
        JSON.stringify(input.payload),
        input.idempotencyKey,
        input.expectedRevision,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error('sync job could not be created');
    const job = mapJob(row);
    if (row.created) {
      await insertAudit(tx, {
        ownerId: input.ownerId,
        jobId: job.jobId,
        eventType: input.auditEvent,
        details: { jobId: job.jobId, state: job.state },
      });
    }
    return job;
  }

  async function claimedJob(
    tx: JourneyQuery,
    input: { ownerId: string; jobId: string; leaseId: string },
  ): Promise<SyncJob | null> {
    const { rows } = await tx<JobRow>(
      `SELECT ${JOB_COLUMNS}
         FROM journey_sync_jobs
        WHERE owner_id = $1 AND id = $2 AND state = 'claimed'
          AND lease_id = $3 AND lease_expires_at > NOW()
        FOR UPDATE`,
      [input.ownerId, input.jobId, input.leaseId],
    );
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async function completedRetry(
    tx: JourneyQuery,
    input: CompleteSyncJobInput,
  ): Promise<SyncJob | null> {
    const { rows } = await tx<JobRow>(
      `SELECT ${JOB_COLUMNS}
         FROM journey_sync_jobs
        WHERE owner_id = $1 AND id = $2 AND state = 'synced'
          AND lease_id = $3 AND result_revision = $4`,
      [input.ownerId, input.jobId, input.leaseId, input.revision],
    );
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async function markConflict(
    tx: JourneyQuery,
    input: {
      ownerId: string;
      jobId: string;
      leaseId: string;
      expectedRevision: string;
      actualRevision: string;
    },
  ): Promise<SyncJob | null> {
    const { rows } = await tx<JobRow>(
      `UPDATE journey_sync_jobs
          SET state = 'conflict', failure_code = $6, conflict_expected_revision = $4,
              conflict_actual_revision = $5, completed_at = NOW(), lease_id = NULL,
              lease_expires_at = NULL, updated_at = NOW()
        WHERE owner_id = $1 AND id = $2 AND state = 'claimed' AND lease_id = $3
        RETURNING ${JOB_COLUMNS}`,
      [
        input.ownerId,
        input.jobId,
        input.leaseId,
        input.expectedRevision,
        input.actualRevision,
        'revision_conflict',
      ],
    );
    const row = rows[0];
    if (!row) return null;
    const job = mapJob(row);
    await insertAudit(tx, {
      ownerId: input.ownerId,
      jobId: input.jobId,
      eventType: 'conflicted',
      details: {
        jobId: input.jobId,
        state: 'conflict',
        errorCode: 'revision_conflict',
        expectedRevision: input.expectedRevision,
        actualRevision: input.actualRevision,
      },
    });
    return job;
  }

  return {
    async getProjection(input: {
      ownerId: string;
      vaultId: string;
    }): Promise<JourneyProjection | null> {
      assertSafeIdentifier(input.ownerId, 'ownerId');
      assertVaultId(input.vaultId);
      const { rows } = await deps.query<ProjectionRow>(
        `SELECT owner_id, vault_id, revision, projection, updated_at
           FROM journey_projections
          WHERE owner_id = $1 AND vault_id = $2`,
        [input.ownerId, input.vaultId],
      );
      return rows[0] ? mapProjection(rows[0]) : null;
    },

    async requestSync(input: RequestSyncInput): Promise<SyncJob> {
      assertRequestIdentifiers(input);
      return deps.withTransaction(async (tx) => {
        const revision = await currentRevision(tx, input.ownerId, input.vaultId);
        return createJob(tx, {
          ...input,
          type: 'sync',
          payload: {},
          expectedRevision: revision,
          auditEvent: 'requested',
        });
      });
    },

    async enqueueMutation(input: EnqueueMutationInput): Promise<SyncJob> {
      assertRequestIdentifiers(input);
      assertMutation(input);
      if (input.expectedRevision) assertRevision(input.expectedRevision);
      const payload: SyncJobPayload =
        input.operation === 'daily_summary'
          ? { operation: 'daily_summary', payload: input.payload }
          : { operation: 'journey_mutation', payload: input.payload };
      return deps.withTransaction(async (tx) => {
        // Mirror `requestSync`: when the caller supplies no expectation, capture
        // the current projection revision inside the same transaction. A daily
        // summary otherwise records a null expectation that can never be met by
        // a compare-and-swap once a projection row exists.
        const expectedRevision =
          input.expectedRevision ?? (await currentRevision(tx, input.ownerId, input.vaultId));
        return createJob(tx, {
          ...input,
          type: 'mutation',
          payload,
          expectedRevision,
          auditEvent: 'enqueued',
        });
      });
    },

    async listPending(input: { ownerId: string; vaultId: string }): Promise<SyncJob[]> {
      assertSafeIdentifier(input.ownerId, 'ownerId');
      assertVaultId(input.vaultId);
      const { rows } = await deps.query<JobRow>(
        `SELECT ${JOB_COLUMNS}
           FROM journey_sync_jobs
          WHERE owner_id = $1 AND vault_id = $2
            AND (state = 'pending' OR (state = 'claimed' AND lease_expires_at <= NOW()))
          ORDER BY created_at ASC, id ASC`,
        [input.ownerId, input.vaultId],
      );
      return rows.map(mapJob);
    },

    async claim(input: ClaimSyncJobInput): Promise<SyncJob | null> {
      assertJobLease(input);
      if (
        !Number.isInteger(input.leaseSeconds) ||
        input.leaseSeconds < 1 ||
        input.leaseSeconds > 300
      ) {
        throw new Error('leaseSeconds must be an integer between 1 and 300');
      }
      return deps.withTransaction(async (tx) => {
        const { rows } = await tx<JobRow>(
          `UPDATE journey_sync_jobs
              SET state = 'claimed', lease_id = $3,
                  lease_expires_at = NOW() + make_interval(secs => $4::int),
                  attempt_count = attempt_count + 1, updated_at = NOW()
            WHERE owner_id = $1 AND id = $2
              AND (state = 'pending' OR (state = 'claimed' AND lease_expires_at <= NOW()))
          RETURNING ${JOB_COLUMNS}`,
          [input.ownerId, input.jobId, input.leaseId, input.leaseSeconds],
        );
        const row = rows[0];
        if (!row) return null;
        const job = mapJob(row);
        await insertAudit(tx, {
          ownerId: input.ownerId,
          jobId: input.jobId,
          eventType: 'claimed',
          details: { jobId: input.jobId, state: job.state },
        });
        return job;
      });
    },

    async complete(input: CompleteSyncJobInput): Promise<SyncJob | null> {
      assertJobLease(input);
      assertRevision(input.revision);
      assertProjection(input.projection);
      return deps.withTransaction(async (tx) => {
        const job = await claimedJob(tx, input);
        if (!job) return completedRetry(tx, input);
        const saved = await saveProjection(
          tx,
          {
            ownerId: input.ownerId,
            vaultId: job.vaultId,
            revision: input.revision,
            expectedRevision: job.expectedRevision,
            projection: input.projection,
          },
          // Complete-path only: a null recorded expectation means there is no
          // precondition to compare against, so the write is an unguarded
          // upsert. A non-null expectation keeps the compare-and-swap, and
          // `recordInboundProjection` never opts out of the guard.
          { unguarded: job.expectedRevision === null },
        );
        if (!saved) {
          const actualRevision = await currentRevision(tx, input.ownerId, job.vaultId);
          if (!actualRevision)
            throw new Error('projection revision disappeared during conflict handling');
          return markConflict(tx, {
            ownerId: input.ownerId,
            jobId: input.jobId,
            leaseId: input.leaseId,
            expectedRevision: job.expectedRevision ?? input.revision,
            actualRevision,
          });
        }
        const { rows } = await tx<JobRow>(
          `UPDATE journey_sync_jobs
              SET state = 'synced', result_revision = $4, completed_at = NOW(),
                  lease_expires_at = NULL, updated_at = NOW()
            WHERE owner_id = $1 AND id = $2 AND state = 'claimed' AND lease_id = $3
          RETURNING ${JOB_COLUMNS}`,
          [input.ownerId, input.jobId, input.leaseId, input.revision],
        );
        const row = rows[0];
        if (!row) throw new Error('claimed sync job disappeared during completion');
        const completed = mapJob(row);
        await insertAudit(tx, {
          ownerId: input.ownerId,
          jobId: input.jobId,
          eventType: 'completed',
          details: { jobId: input.jobId, state: completed.state, revision: input.revision },
        });
        return completed;
      });
    },

    async fail(input: FailSyncJobInput): Promise<SyncJob | null> {
      assertJobLease(input);
      assertErrorCode(input.errorCode);
      if (input.state === 'conflict') {
        if (!input.expectedRevision || !input.actualRevision) {
          throw new Error('conflict requires both revision hashes');
        }
        assertRevision(input.expectedRevision);
        assertRevision(input.actualRevision);
      } else {
        if (input.expectedRevision) assertRevision(input.expectedRevision);
        if (input.actualRevision) assertRevision(input.actualRevision);
      }
      return deps.withTransaction(async (tx) => {
        const { rows } = await tx<JobRow>(
          `UPDATE journey_sync_jobs
              SET state = $4, failure_code = $5, conflict_expected_revision = $6,
                  conflict_actual_revision = $7, completed_at = NOW(), lease_id = NULL,
                  lease_expires_at = NULL, updated_at = NOW()
            WHERE owner_id = $1 AND id = $2
              AND state = 'claimed' AND lease_id = $3 AND lease_expires_at > NOW()
          RETURNING ${JOB_COLUMNS}`,
          [
            input.ownerId,
            input.jobId,
            input.leaseId,
            input.state,
            input.errorCode,
            input.expectedRevision ?? null,
            input.actualRevision ?? null,
          ],
        );
        const row = rows[0];
        if (!row) return null;
        const job = mapJob(row);
        const eventType = input.state === 'conflict' ? 'conflicted' : 'failed';
        await insertAudit(tx, {
          ownerId: input.ownerId,
          jobId: input.jobId,
          eventType,
          details: {
            jobId: input.jobId,
            state: input.state,
            errorCode: input.errorCode,
            ...(input.expectedRevision ? { expectedRevision: input.expectedRevision } : {}),
            ...(input.actualRevision ? { actualRevision: input.actualRevision } : {}),
          },
        });
        return job;
      });
    },

    async recordInboundProjection(input: RecordInboundProjectionInput): Promise<SyncJob | null> {
      assertJobLease(input);
      assertVaultId(input.vaultId);
      assertRevision(input.revision);
      if (input.expectedRevision) assertRevision(input.expectedRevision);
      assertProjection(input.projection);
      return deps.withTransaction(async (tx) => {
        const job = await claimedJob(tx, input);
        if (!job) return null;
        if (job.vaultId !== input.vaultId) {
          throw new Error('inbound projection vault does not match the claimed job');
        }
        if (job.expectedRevision !== input.expectedRevision) {
          const actualRevision = await currentRevision(tx, input.ownerId, input.vaultId);
          if (!actualRevision)
            throw new Error('projection revision disappeared during conflict handling');
          return markConflict(tx, {
            ownerId: input.ownerId,
            jobId: input.jobId,
            leaseId: input.leaseId,
            expectedRevision: input.expectedRevision ?? input.revision,
            actualRevision,
          });
        }
        const saved = await saveProjection(tx, input);
        if (!saved) {
          const actualRevision = await currentRevision(tx, input.ownerId, input.vaultId);
          if (!actualRevision)
            throw new Error('projection revision disappeared during conflict handling');
          return markConflict(tx, {
            ownerId: input.ownerId,
            jobId: input.jobId,
            leaseId: input.leaseId,
            expectedRevision: input.expectedRevision ?? input.revision,
            actualRevision,
          });
        }
        await insertAudit(tx, {
          ownerId: input.ownerId,
          jobId: input.jobId,
          eventType: 'projection_recorded',
          details: { jobId: input.jobId, vaultId: input.vaultId, revision: input.revision },
        });
        return job;
      });
    },
  };
}

export type SyncRepository = ReturnType<typeof createSyncRepository>;
