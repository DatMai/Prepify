import type {
  ClaimSyncJobInput,
  CompleteSyncJobInput,
  EnqueueMutationInput,
  FailSyncJobInput,
  JourneyProjection,
  JourneyQuery,
  JourneyTransaction,
  JsonObject,
  RecordInboundProjectionInput,
  RequestSyncInput,
  SyncJob,
  SyncJobType,
  SyncState,
} from './syncTypes';

interface ProjectionRow extends Record<string, unknown> {
  owner_id: string;
  vault_id: string;
  revision: string;
  projection: JsonObject;
  updated_at: string | Date;
}

interface JobRow extends Record<string, unknown> {
  id: string;
  owner_id: string;
  vault_id: string;
  job_type: SyncJobType;
  payload: JsonObject;
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
  if (!/^[a-f0-9]{64}$/.test(revision)) {
    throw new Error('revision must be a lowercase SHA-256 hash');
  }
}

function assertErrorCode(errorCode: string): void {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(errorCode)) {
    throw new Error('errorCode must be a sanitized error code');
  }
}

function assertStructuredJson(value: JsonObject, field: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a JSON object`);
  }

  const visit = (entry: JsonObject | unknown[]): void => {
    for (const [key, child] of Object.entries(entry)) {
      if (key === 'path' || key === 'markdown') {
        throw new Error(`${field} must not contain ${key}`);
      }
      if (typeof child === 'object' && child !== null) visit(child as JsonObject | unknown[]);
    }
  };

  visit(value);
  JSON.stringify(value);
}

async function insertAudit(
  query: JourneyQuery,
  input: { ownerId: string; jobId: string | null; eventType: string; details: JsonObject },
): Promise<void> {
  await query(
    `INSERT INTO journey_audit_events (owner_id, job_id, event_type, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [input.ownerId, input.jobId, input.eventType, JSON.stringify(input.details)],
  );
}

async function upsertProjection(query: JourneyQuery, input: RecordInboundProjectionInput): Promise<void> {
  await query(
    `INSERT INTO journey_projections (owner_id, vault_id, revision, projection)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (owner_id, vault_id)
     DO UPDATE SET revision = EXCLUDED.revision, projection = EXCLUDED.projection, updated_at = NOW()`,
    [input.ownerId, input.vaultId, input.revision, JSON.stringify(input.projection)],
  );
}

export function createSyncRepository(deps: { query: JourneyQuery; withTransaction: JourneyTransaction }) {
  async function createJob(
    tx: JourneyQuery,
    input: RequestSyncInput & {
      type: SyncJobType;
      payload: JsonObject;
      expectedRevision?: string | null;
      auditEvent: 'requested' | 'enqueued';
    },
  ): Promise<SyncJob> {
    const includesExpectedRevision = input.expectedRevision !== undefined;
    const { rows } = await tx<JobRow>(
      `INSERT INTO journey_sync_jobs
         (owner_id, vault_id, job_type, payload, idempotency_key${
           includesExpectedRevision ? ', expected_revision' : ''
         })
       VALUES ($1, $2, $3, $4::jsonb, $5${includesExpectedRevision ? ', $6' : ''})
       ON CONFLICT (owner_id, idempotency_key)
       DO UPDATE SET idempotency_key = journey_sync_jobs.idempotency_key
       RETURNING ${JOB_COLUMNS}, (xmax = 0) AS created`,
      includesExpectedRevision
        ? [
            input.ownerId,
            input.vaultId,
            input.type,
            JSON.stringify(input.payload),
            input.idempotencyKey,
            input.expectedRevision ?? null,
          ]
        : [input.ownerId, input.vaultId, input.type, JSON.stringify(input.payload), input.idempotencyKey],
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

  return {
    async getProjection(input: { ownerId: string; vaultId: string }): Promise<JourneyProjection | null> {
      const { rows } = await deps.query<ProjectionRow>(
        `SELECT owner_id, vault_id, revision, projection, updated_at
           FROM journey_projections
          WHERE owner_id = $1 AND vault_id = $2`,
        [input.ownerId, input.vaultId],
      );
      return rows[0] ? mapProjection(rows[0]) : null;
    },

    async requestSync(input: RequestSyncInput): Promise<SyncJob> {
      return deps.withTransaction((tx) =>
        createJob(tx, { ...input, type: 'sync', payload: {}, auditEvent: 'requested' }),
      );
    },

    async enqueueMutation(input: EnqueueMutationInput): Promise<SyncJob> {
      assertStructuredJson(input.payload, 'payload');
      if (input.expectedRevision) assertRevision(input.expectedRevision);
      return deps.withTransaction((tx) =>
        createJob(tx, {
          ...input,
          type: 'mutation',
          payload: { operation: input.operation, payload: input.payload },
          auditEvent: 'enqueued',
        }),
      );
    },

    async listPending(input: { ownerId: string; vaultId: string }): Promise<SyncJob[]> {
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
      if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 1 || input.leaseSeconds > 300) {
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
      assertRevision(input.revision);
      assertStructuredJson(input.projection, 'projection');
      return deps.withTransaction(async (tx) => {
        const { rows } = await tx<JobRow>(
          `UPDATE journey_sync_jobs
              SET state = 'synced', result_revision = $4, completed_at = NOW(),
                  lease_id = NULL, lease_expires_at = NULL, updated_at = NOW()
            WHERE owner_id = $1 AND id = $2
              AND state = 'claimed' AND lease_id = $3 AND lease_expires_at > NOW()
          RETURNING ${JOB_COLUMNS}`,
          [input.ownerId, input.jobId, input.leaseId, input.revision],
        );
        const row = rows[0];
        if (!row) return null;
        const job = mapJob(row);
        await upsertProjection(tx, {
          ownerId: input.ownerId,
          vaultId: job.vaultId,
          revision: input.revision,
          projection: input.projection,
        });
        await insertAudit(tx, {
          ownerId: input.ownerId,
          jobId: input.jobId,
          eventType: 'completed',
          details: { jobId: input.jobId, state: job.state, revision: input.revision },
        });
        return job;
      });
    },

    async fail(input: FailSyncJobInput): Promise<SyncJob | null> {
      assertErrorCode(input.errorCode);
      if (input.expectedRevision) assertRevision(input.expectedRevision);
      if (input.actualRevision) assertRevision(input.actualRevision);
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

    async recordInboundProjection(input: RecordInboundProjectionInput): Promise<void> {
      assertRevision(input.revision);
      assertStructuredJson(input.projection, 'projection');
      await deps.withTransaction(async (tx) => {
        await upsertProjection(tx, input);
        await insertAudit(tx, {
          ownerId: input.ownerId,
          jobId: null,
          eventType: 'projection_recorded',
          details: { vaultId: input.vaultId, revision: input.revision },
        });
      });
    },
  };
}

export type SyncRepository = ReturnType<typeof createSyncRepository>;
