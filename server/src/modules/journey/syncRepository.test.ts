import { describe, expect, it, vi } from 'vitest';
import { createSyncRepository } from './syncRepository';
import type { JourneyQuery } from './syncTypes';

const sha = 'a'.repeat(64);
const expectedRevision = 'b'.repeat(64);
const actualRevision = 'c'.repeat(64);

function validProjection() {
  return {
    daily: {
      date: '2026-09-12',
      stage: 'AZ-104',
      tasks: [
        {
          id: 'task-1',
          checked: true,
          text: 'Review virtual networks',
          tags: ['#az104'],
        },
      ],
      evidence: ['Completed the virtual-network lab'],
      journal: {
        done: 'Reviewed the virtual network module.',
        blocked: '',
        next: 'Practice firewall rules.',
      },
    },
  };
}

const pendingJob = {
  id: 'job-1',
  owner_id: 'owner-1',
  vault_id: 'vault-main',
  job_type: 'sync',
  payload: {},
  idempotency_key: 'event_12345678',
  expected_revision: null,
  state: 'pending',
  lease_id: null,
  lease_expires_at: null,
  attempt_count: 0,
  completed_at: null,
  failure_code: null,
  conflict_expected_revision: null,
  conflict_actual_revision: null,
  created_at: '2026-09-12T00:00:00.000Z',
  updated_at: '2026-09-12T00:00:00.000Z',
};

type Responder = (text: string, values: unknown[]) => { rows: unknown[] } | undefined;

function harness(responder?: Responder) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    return responder?.(text, values) ?? { rows: [] };
  });
  const withTransaction = vi.fn(async (fn: (tx: JourneyQuery) => Promise<unknown>) =>
    fn(query as unknown as JourneyQuery),
  );

  return {
    calls,
    withTransaction,
    repo: createSyncRepository({
      query: query as unknown as JourneyQuery,
      withTransaction: withTransaction as never,
    }),
  };
}

describe('createSyncRepository', () => {
  it('creates a parameterized sync request and audits the new pending job atomically', async () => {
    const { repo, calls, withTransaction } = harness((text) => {
      if (text.includes('INSERT INTO journey_sync_jobs')) {
        return { rows: [{ ...pendingJob, created: true }] };
      }
      return undefined;
    });

    const result = await repo.requestSync({
      ownerId: 'owner-1',
      vaultId: 'vault-main',
      idempotencyKey: 'event_12345678',
    });

    expect(withTransaction).toHaveBeenCalledTimes(1);
    const insert = calls.find((call) => call.text.includes('INSERT INTO journey_sync_jobs'));
    expect(insert?.text).toContain('VALUES ($1, $2, $3, $4::jsonb, $5, $6)');
    expect(insert?.values).toEqual(['owner-1', 'vault-main', 'sync', '{}', 'event_12345678', null]);
    const audit = calls.find((call) => call.text.includes('INSERT INTO journey_audit_events'));
    expect(audit?.values).toEqual([
      'owner-1',
      'job-1',
      'requested',
      JSON.stringify({ jobId: 'job-1', state: 'pending' }),
    ]);
    expect(result).toMatchObject({ jobId: 'job-1', state: 'pending', completedAt: null });
  });

  it('returns the existing job for a duplicate idempotency key without another audit event', async () => {
    const { repo, calls } = harness((text) => {
      if (text.includes('INSERT INTO journey_sync_jobs')) {
        return { rows: [{ ...pendingJob, id: 'existing-job', created: false }] };
      }
      return undefined;
    });

    const result = await repo.requestSync({
      ownerId: 'owner-1',
      vaultId: 'vault-main',
      idempotencyKey: 'event_12345678',
    });

    expect(result).toMatchObject({ jobId: 'existing-job', state: 'pending' });
    expect(
      calls.filter((call) => call.text.includes('INSERT INTO journey_audit_events')),
    ).toHaveLength(0);
  });

  it('captures the current projection revision when a sync request enters the outbox', async () => {
    const { repo, calls } = harness((text) => {
      if (text.includes('SELECT revision FROM journey_projections')) {
        return { rows: [{ revision: expectedRevision }] };
      }
      if (text.includes('INSERT INTO journey_sync_jobs')) {
        return { rows: [{ ...pendingJob, expected_revision: expectedRevision, created: true }] };
      }
      return undefined;
    });

    await repo.requestSync({
      ownerId: 'owner-1',
      vaultId: 'vault-main',
      idempotencyKey: 'event_12345678',
    });

    expect(
      calls.find((call) => call.text.includes('INSERT INTO journey_sync_jobs'))?.values,
    ).toEqual(['owner-1', 'vault-main', 'sync', '{}', 'event_12345678', expectedRevision]);
  });

  it('reclaims an expired lease, increments its attempt count, and writes an audit event', async () => {
    const { repo, calls, withTransaction } = harness((text) => {
      if (text.includes("SET state = 'claimed'")) {
        return {
          rows: [
            {
              ...pendingJob,
              state: 'claimed',
              lease_id: 'lease-1',
              lease_expires_at: '2026-09-12T00:00:30.000Z',
              attempt_count: 2,
            },
          ],
        };
      }
      return undefined;
    });

    const claimed = await repo.claim({
      ownerId: 'owner-1',
      jobId: 'job-1',
      leaseId: 'lease-1',
      leaseSeconds: 30,
    });

    expect(withTransaction).toHaveBeenCalledTimes(1);
    const claim = calls.find((call) => call.text.includes("SET state = 'claimed'"));
    expect(claim?.text).toContain(
      "state = 'pending' OR (state = 'claimed' AND lease_expires_at <= NOW())",
    );
    expect(claim?.text).toContain('make_interval(secs => $4::int)');
    expect(claim?.values).toEqual(['owner-1', 'job-1', 'lease-1', 30]);
    expect(claimed).toMatchObject({ jobId: 'job-1', state: 'claimed', attemptCount: 2 });
    expect(
      calls.find((call) => call.text.includes('INSERT INTO journey_audit_events'))?.values,
    ).toEqual([
      'owner-1',
      'job-1',
      'claimed',
      JSON.stringify({ jobId: 'job-1', state: 'claimed' }),
    ]);
  });

  it('does not complete a job or alter its projection when the lease is incorrect', async () => {
    const { repo, calls } = harness();

    const completed = await repo.complete({
      ownerId: 'owner-1',
      jobId: 'job-1',
      leaseId: 'wrong-lease',
      revision: sha,
      projection: validProjection(),
    });

    expect(completed).toBeNull();
    expect(calls.some((call) => call.text.includes('INSERT INTO journey_projections'))).toBe(false);
    expect(calls.some((call) => call.text.includes('INSERT INTO journey_audit_events'))).toBe(
      false,
    );
  });

  it('commits the returned projection, completed state, and sanitized audit event in one transaction', async () => {
    const { repo, calls, withTransaction } = harness((text) => {
      if (text.includes('FOR UPDATE')) {
        return { rows: [{ ...pendingJob, state: 'claimed', lease_id: 'lease-1' }] };
      }
      if (text.includes('INSERT INTO journey_projections')) return { rows: [{ revision: sha }] };
      if (text.includes("SET state = 'synced'")) {
        return {
          rows: [
            {
              ...pendingJob,
              state: 'synced',
              completed_at: '2026-09-12T00:01:00.000Z',
            },
          ],
        };
      }
      return undefined;
    });
    const projection = validProjection();

    const completed = await repo.complete({
      ownerId: 'owner-1',
      jobId: 'job-1',
      leaseId: 'lease-1',
      revision: sha,
      projection,
    });

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(completed).toMatchObject({
      jobId: 'job-1',
      state: 'synced',
      completedAt: '2026-09-12T00:01:00.000Z',
    });
    const savedProjection = calls.find((call) =>
      call.text.includes('INSERT INTO journey_projections'),
    );
    // This job records no expectation, so the statement is the unguarded upsert
    // and declares only $1..$4. The previous expectation pinned a trailing
    // `null` here, which bound five values to a four-placeholder statement and
    // made PostgreSQL reject the completion with 08P01 in production while every
    // mocked assertion stayed green.
    expect(savedProjection?.text).not.toContain('IS NOT DISTINCT FROM $5');
    expect(savedProjection?.values).toEqual([
      'owner-1',
      'vault-main',
      sha,
      JSON.stringify(projection),
    ]);
    expect(
      calls.find((call) => call.text.includes('INSERT INTO journey_audit_events'))?.values,
    ).toEqual([
      'owner-1',
      'job-1',
      'completed',
      JSON.stringify({ jobId: 'job-1', state: 'synced', revision: sha }),
    ]);
  });

  it('preserves both revisions when a claimed job enters conflict', async () => {
    const { repo, calls } = harness((text) => {
      if (text.includes('SET state = $4')) {
        return {
          rows: [
            {
              ...pendingJob,
              state: 'conflict',
              conflict_expected_revision: expectedRevision,
              conflict_actual_revision: actualRevision,
              completed_at: '2026-09-12T00:01:00.000Z',
            },
          ],
        };
      }
      return undefined;
    });

    const failed = await repo.fail({
      ownerId: 'owner-1',
      jobId: 'job-1',
      leaseId: 'lease-1',
      state: 'conflict',
      errorCode: 'revision_conflict',
      expectedRevision,
      actualRevision,
    });

    expect(failed).toMatchObject({
      state: 'conflict',
      conflictExpectedRevision: expectedRevision,
      conflictActualRevision: actualRevision,
    });
    const conflict = calls.find((call) => call.text.includes('SET state = $4'));
    expect(conflict?.values).toEqual([
      'owner-1',
      'job-1',
      'lease-1',
      'conflict',
      'revision_conflict',
      expectedRevision,
      actualRevision,
    ]);
    expect(
      calls.find((call) => call.text.includes('INSERT INTO journey_audit_events'))?.values,
    ).toEqual([
      'owner-1',
      'job-1',
      'conflicted',
      JSON.stringify({
        jobId: 'job-1',
        state: 'conflict',
        errorCode: 'revision_conflict',
        expectedRevision,
        actualRevision,
      }),
    ]);
  });

  it('rejects arbitrary failure text so an audit event cannot contain vault content', async () => {
    const { repo, calls } = harness();

    await expect(
      repo.fail({
        ownerId: 'owner-1',
        jobId: 'job-1',
        leaseId: 'lease-1',
        state: 'failed',
        errorCode: 'could not write Daily/private.md',
      }),
    ).rejects.toThrow('errorCode must be a sanitized error code');

    expect(calls).toHaveLength(0);
  });

  it('rejects vault aliases and free-text bodies before they can enter JSONB', async () => {
    const { repo, calls } = harness();
    const projection = validProjection() as Record<string, unknown>;
    projection.filePath = 'Daily/private.md';
    projection.content = '## Private vault body';

    await expect(
      repo.complete({
        ownerId: 'owner-1',
        jobId: 'job-1',
        leaseId: 'lease-1',
        revision: sha,
        projection: projection as never,
      }),
    ).rejects.toThrow('projection must match the allowlisted schema');
    await expect(
      repo.requestSync({
        ownerId: 'owner-1',
        vaultId: 'vault-main/Daily',
        idempotencyKey: 'event_12345678',
      }),
    ).rejects.toThrow('vaultId must be a safe identifier');

    expect(calls).toHaveLength(0);
  });

  it('rejects an unallowlisted mutation body before it can enter the outbox', async () => {
    const { repo, calls } = harness();

    await expect(
      repo.enqueueMutation({
        ownerId: 'owner-1',
        vaultId: 'vault-main',
        idempotencyKey: 'event_12345678',
        operation: 'daily_summary',
        payload: {
          date: '2026-09-12',
          score: 3,
          total: 5,
          content: '## Arbitrary vault body',
        },
      } as never),
    ).rejects.toThrow('payload must match the allowlisted schema');

    expect(calls).toHaveLength(0);
  });

  it('records a stale completion as a conflict instead of replacing a newer projection', async () => {
    const { repo, calls } = harness((text) => {
      if (text.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              ...pendingJob,
              state: 'claimed',
              lease_id: 'lease-1',
              expected_revision: expectedRevision,
            },
          ],
        };
      }
      if (text.includes('INSERT INTO journey_projections')) return { rows: [] };
      if (text.includes('SELECT revision FROM journey_projections')) {
        return { rows: [{ revision: actualRevision }] };
      }
      if (text.includes("SET state = 'conflict'")) {
        return {
          rows: [
            {
              ...pendingJob,
              state: 'conflict',
              conflict_expected_revision: expectedRevision,
              conflict_actual_revision: actualRevision,
              completed_at: '2026-09-12T00:01:00.000Z',
            },
          ],
        };
      }
      return undefined;
    });

    const result = await repo.complete({
      ownerId: 'owner-1',
      jobId: 'job-1',
      leaseId: 'lease-1',
      revision: sha,
      projection: validProjection(),
    });

    expect(result).toMatchObject({
      state: 'conflict',
      conflictExpectedRevision: expectedRevision,
      conflictActualRevision: actualRevision,
    });
    expect(
      calls.find((call) => call.text.includes('INSERT INTO journey_projections'))?.text,
    ).toContain('WHERE journey_projections.revision IS NOT DISTINCT FROM $5');
    expect(calls.find((call) => call.text.includes("SET state = 'conflict'"))?.values).toEqual([
      'owner-1',
      'job-1',
      'lease-1',
      expectedRevision,
      actualRevision,
      'revision_conflict',
    ]);
  });

  it('records a stale inbound projection as a lease-bound conflict', async () => {
    const { repo, calls } = harness((text) => {
      if (text.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              ...pendingJob,
              state: 'claimed',
              lease_id: 'lease-1',
              expected_revision: expectedRevision,
            },
          ],
        };
      }
      if (text.includes('INSERT INTO journey_projections')) return { rows: [] };
      if (text.includes('SELECT revision FROM journey_projections')) {
        return { rows: [{ revision: actualRevision }] };
      }
      if (text.includes("SET state = 'conflict'")) {
        return {
          rows: [
            {
              ...pendingJob,
              state: 'conflict',
              conflict_expected_revision: expectedRevision,
              conflict_actual_revision: actualRevision,
            },
          ],
        };
      }
      return undefined;
    });

    const result = await repo.recordInboundProjection({
      ownerId: 'owner-1',
      vaultId: 'vault-main',
      jobId: 'job-1',
      leaseId: 'lease-1',
      expectedRevision,
      revision: sha,
      projection: validProjection(),
    });

    expect(result).toMatchObject({ state: 'conflict', conflictActualRevision: actualRevision });
    expect(calls.find((call) => call.text.includes("SET state = 'conflict'"))?.values).toEqual([
      'owner-1',
      'job-1',
      'lease-1',
      expectedRevision,
      actualRevision,
      'revision_conflict',
    ]);
  });

  it('records a stale inbound base revision as a conflict instead of throwing', async () => {
    const staleBase = 'd'.repeat(64);
    const { repo, calls } = harness((text) => {
      if (text.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              ...pendingJob,
              state: 'claimed',
              lease_id: 'lease-1',
              expected_revision: expectedRevision,
            },
          ],
        };
      }
      if (text.includes('SELECT revision FROM journey_projections')) {
        return { rows: [{ revision: actualRevision }] };
      }
      if (text.includes("SET state = 'conflict'")) {
        return {
          rows: [
            {
              ...pendingJob,
              state: 'conflict',
              conflict_expected_revision: staleBase,
              conflict_actual_revision: actualRevision,
            },
          ],
        };
      }
      return undefined;
    });

    const result = await repo.recordInboundProjection({
      ownerId: 'owner-1',
      vaultId: 'vault-main',
      jobId: 'job-1',
      leaseId: 'lease-1',
      expectedRevision: staleBase,
      revision: sha,
      projection: validProjection(),
    });

    expect(result).toMatchObject({
      state: 'conflict',
      conflictExpectedRevision: staleBase,
      conflictActualRevision: actualRevision,
    });
    expect(calls.find((call) => call.text.includes("SET state = 'conflict'"))?.values).toEqual([
      'owner-1',
      'job-1',
      'lease-1',
      staleBase,
      actualRevision,
      'revision_conflict',
    ]);
  });

  it('requires both valid revisions before a job can enter conflict', async () => {
    const { repo, calls } = harness();

    await expect(
      repo.fail({
        ownerId: 'owner-1',
        jobId: 'job-1',
        leaseId: 'lease-1',
        state: 'conflict',
        errorCode: 'revision_conflict',
        expectedRevision,
      } as never),
    ).rejects.toThrow('conflict requires both revision hashes');

    expect(calls).toHaveLength(0);
  });

  it('returns the stored successful completion to a bridge retry with the same lease and revision', async () => {
    const { repo, calls } = harness((text) => {
      if (text.includes("SET state = 'synced'")) return { rows: [] };
      if (text.includes("state = 'synced'")) {
        return {
          rows: [
            {
              ...pendingJob,
              state: 'synced',
              lease_id: 'lease-1',
              result_revision: sha,
              completed_at: '2026-09-12T00:01:00.000Z',
            },
          ],
        };
      }
      return undefined;
    });

    const result = await repo.complete({
      ownerId: 'owner-1',
      jobId: 'job-1',
      leaseId: 'lease-1',
      revision: sha,
      projection: validProjection(),
    });

    expect(result).toMatchObject({ jobId: 'job-1', state: 'synced' });
    expect(calls.find((call) => call.text.includes("state = 'synced'"))?.text).toContain(
      'lease_id = $3 AND result_revision = $4',
    );
    expect(calls.some((call) => call.text.includes('INSERT INTO journey_projections'))).toBe(false);
  });

  it('records an inbound structured projection without putting it in the audit event', async () => {
    const { repo, calls } = harness((text) => {
      if (text.includes('FOR UPDATE')) {
        return { rows: [{ ...pendingJob, state: 'claimed', lease_id: 'lease-1' }] };
      }
      if (text.includes('INSERT INTO journey_projections')) return { rows: [{ revision: sha }] };
      return undefined;
    });
    const projection = validProjection();

    await repo.recordInboundProjection({
      ownerId: 'owner-1',
      vaultId: 'vault-main',
      jobId: 'job-1',
      leaseId: 'lease-1',
      expectedRevision: null,
      revision: sha,
      projection,
    });

    expect(
      calls.find((call) => call.text.includes('INSERT INTO journey_projections'))?.values,
    ).toEqual(['owner-1', 'vault-main', sha, JSON.stringify(projection), null]);
    const audit = calls.find((call) => call.text.includes('INSERT INTO journey_audit_events'));
    expect(audit?.values).toEqual([
      'owner-1',
      'job-1',
      'projection_recorded',
      JSON.stringify({ jobId: 'job-1', vaultId: 'vault-main', revision: sha }),
    ]);
    expect(JSON.stringify(audit?.values)).not.toContain('Review virtual networks');
  });

  it('captures the current projection revision when a mutation has no explicit expectation', async () => {
    const { repo, calls } = harness((text) => {
      if (text.includes('SELECT revision FROM journey_projections')) {
        return { rows: [{ revision: expectedRevision }] };
      }
      if (text.includes('INSERT INTO journey_sync_jobs')) {
        return {
          rows: [
            {
              ...pendingJob,
              job_type: 'mutation',
              expected_revision: expectedRevision,
              created: true,
            },
          ],
        };
      }
      return undefined;
    });

    await repo.enqueueMutation({
      ownerId: 'owner-1',
      vaultId: 'vault-main',
      idempotencyKey: 'event_12345678',
      operation: 'daily_summary',
      payload: { date: '2026-09-12', score: 3, total: 5 },
    });

    expect(
      calls.some((call) => call.text.includes('SELECT revision FROM journey_projections')),
    ).toBe(true);
    expect(
      calls.find((call) => call.text.includes('INSERT INTO journey_sync_jobs'))?.values,
    ).toEqual([
      'owner-1',
      'vault-main',
      'mutation',
      JSON.stringify({
        operation: 'daily_summary',
        payload: { date: '2026-09-12', score: 3, total: 5 },
      }),
      'event_12345678',
      expectedRevision,
    ]);
  });

  it('completes a null-expectation mutation as an unguarded upsert instead of a fabricated conflict', async () => {
    // A projection row already exists at `expectedRevision`, exactly like the
    // second daily-summary sync. A null recorded expectation has no precondition
    // to compare against, so the write must not be blocked by the guard.
    const { repo, calls } = harness((text, values) => {
      if (text.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              ...pendingJob,
              job_type: 'mutation',
              state: 'claimed',
              lease_id: 'lease-1',
              expected_revision: null,
            },
          ],
        };
      }
      if (text.includes('INSERT INTO journey_projections')) {
        const guarded = text.includes('IS NOT DISTINCT FROM $5');
        const matches = !guarded || expectedRevision === values[4];
        return { rows: matches ? [{ revision: values[2] }] : [] };
      }
      if (text.includes("SET state = 'synced'")) {
        return {
          rows: [
            {
              ...pendingJob,
              job_type: 'mutation',
              state: 'synced',
              completed_at: '2026-09-12T00:01:00.000Z',
            },
          ],
        };
      }
      if (text.includes('SELECT revision FROM journey_projections')) {
        return { rows: [{ revision: expectedRevision }] };
      }
      if (text.includes("SET state = 'conflict'")) {
        return {
          rows: [
            {
              ...pendingJob,
              state: 'conflict',
              conflict_expected_revision: sha,
              conflict_actual_revision: expectedRevision,
              completed_at: '2026-09-12T00:01:00.000Z',
            },
          ],
        };
      }
      return undefined;
    });

    const result = await repo.complete({
      ownerId: 'owner-1',
      jobId: 'job-1',
      leaseId: 'lease-1',
      revision: sha,
      projection: validProjection(),
    });

    expect(result).toMatchObject({ state: 'synced' });
    expect(
      calls.find((call) => call.text.includes('INSERT INTO journey_projections'))?.text,
    ).not.toContain('IS NOT DISTINCT FROM $5');
    expect(calls.some((call) => call.text.includes("SET state = 'conflict'"))).toBe(false);
  });

  it('binds exactly one parameter per placeholder in every statement it issues', async () => {
    // Mocked queries never execute SQL, so a statement that declares $1..$4 but
    // receives five values passes every behavioural assertion here and then
    // fails against PostgreSQL with 08P01. Assert the invariant itself.
    const jobWithNullExpectation = {
      ...pendingJob,
      job_type: 'mutation',
      state: 'claimed',
      lease_id: 'lease-1',
      expected_revision: null,
    };
    const { repo, calls } = harness((text) => {
      if (text.includes('FOR UPDATE')) return { rows: [jobWithNullExpectation] };
      if (text.includes('INSERT INTO journey_projections')) return { rows: [{ revision: sha }] };
      if (text.includes("SET state = 'synced'")) {
        return { rows: [{ ...jobWithNullExpectation, state: 'synced' }] };
      }
      return undefined;
    });

    await repo.complete({
      ownerId: 'owner-1',
      jobId: 'job-1',
      leaseId: 'lease-1',
      revision: sha,
      projection: validProjection(),
    });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const placeholders = new Set(call.text.match(/\$\d+/g) ?? []);
      expect(
        call.values.length,
        `${call.text.trim().slice(0, 60)} declares ${placeholders.size} placeholders`,
      ).toBe(placeholders.size);
    }
  });

  it('still reports a real conflict when an outbound mutation records a stale expectation', async () => {
    const { repo, calls } = harness((text, values) => {
      if (text.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              ...pendingJob,
              job_type: 'mutation',
              state: 'claimed',
              lease_id: 'lease-1',
              expected_revision: expectedRevision,
            },
          ],
        };
      }
      if (text.includes('INSERT INTO journey_projections')) {
        const guarded = text.includes('IS NOT DISTINCT FROM $5');
        const matches = !guarded || actualRevision === values[4];
        return { rows: matches ? [{ revision: values[2] }] : [] };
      }
      if (text.includes('SELECT revision FROM journey_projections')) {
        return { rows: [{ revision: actualRevision }] };
      }
      if (text.includes("SET state = 'conflict'")) {
        return {
          rows: [
            {
              ...pendingJob,
              job_type: 'mutation',
              state: 'conflict',
              conflict_expected_revision: expectedRevision,
              conflict_actual_revision: actualRevision,
              completed_at: '2026-09-12T00:01:00.000Z',
            },
          ],
        };
      }
      return undefined;
    });

    const result = await repo.complete({
      ownerId: 'owner-1',
      jobId: 'job-1',
      leaseId: 'lease-1',
      revision: sha,
      projection: validProjection(),
    });

    expect(result).toMatchObject({
      state: 'conflict',
      conflictExpectedRevision: expectedRevision,
      conflictActualRevision: actualRevision,
    });
    expect(calls.find((call) => call.text.includes("SET state = 'conflict'"))?.values).toEqual([
      'owner-1',
      'job-1',
      'lease-1',
      expectedRevision,
      actualRevision,
      'revision_conflict',
    ]);
  });

  it('keeps enforcing the inbound guard for a null expectation when a projection already exists', async () => {
    const { repo, calls } = harness((text, values) => {
      if (text.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              ...pendingJob,
              state: 'claimed',
              lease_id: 'lease-1',
              expected_revision: null,
            },
          ],
        };
      }
      if (text.includes('INSERT INTO journey_projections')) {
        const guarded = text.includes('IS NOT DISTINCT FROM $5');
        const matches = !guarded || actualRevision === values[4];
        return { rows: matches ? [{ revision: values[2] }] : [] };
      }
      if (text.includes('SELECT revision FROM journey_projections')) {
        return { rows: [{ revision: actualRevision }] };
      }
      if (text.includes("SET state = 'conflict'")) {
        return {
          rows: [
            {
              ...pendingJob,
              state: 'conflict',
              conflict_expected_revision: sha,
              conflict_actual_revision: actualRevision,
            },
          ],
        };
      }
      return undefined;
    });

    const result = await repo.recordInboundProjection({
      ownerId: 'owner-1',
      vaultId: 'vault-main',
      jobId: 'job-1',
      leaseId: 'lease-1',
      expectedRevision: null,
      revision: sha,
      projection: validProjection(),
    });

    expect(result).toMatchObject({ state: 'conflict', conflictActualRevision: actualRevision });
    expect(
      calls.find((call) => call.text.includes('INSERT INTO journey_projections'))?.text,
    ).toContain('IS NOT DISTINCT FROM $5');
  });
});
