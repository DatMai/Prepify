import { describe, expect, it, vi } from 'vitest';
import { createSyncRepository } from './syncRepository';
import type { JourneyQuery } from './syncTypes';

const sha = 'a'.repeat(64);

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
    expect(insert?.text).toContain('VALUES ($1, $2, $3, $4::jsonb, $5)');
    expect(insert?.values).toEqual(['owner-1', 'vault-main', 'sync', '{}', 'event_12345678']);
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
    expect(calls.filter((call) => call.text.includes('INSERT INTO journey_audit_events'))).toHaveLength(0);
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
    expect(claim?.text).toContain("state = 'pending' OR (state = 'claimed' AND lease_expires_at <= NOW())");
    expect(claim?.text).toContain("make_interval(secs => $4::int)");
    expect(claim?.values).toEqual(['owner-1', 'job-1', 'lease-1', 30]);
    expect(claimed).toMatchObject({ jobId: 'job-1', state: 'claimed', attemptCount: 2 });
    expect(calls.find((call) => call.text.includes('INSERT INTO journey_audit_events'))?.values).toEqual([
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
      projection: { daily: { date: '2026-09-12', tasks: [] } },
    });

    expect(completed).toBeNull();
    const completion = calls.find((call) => call.text.includes("SET state = 'synced'"));
    expect(completion?.text).toContain("state = 'claimed' AND lease_id = $3");
    expect(calls.some((call) => call.text.includes('INSERT INTO journey_projections'))).toBe(false);
    expect(calls.some((call) => call.text.includes('INSERT INTO journey_audit_events'))).toBe(false);
  });

  it('commits the returned projection, completed state, and sanitized audit event in one transaction', async () => {
    const { repo, calls, withTransaction } = harness((text) => {
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
    const projection = { daily: { date: '2026-09-12', tasks: [{ id: 'task-1', done: true }] } };

    const completed = await repo.complete({
      ownerId: 'owner-1',
      jobId: 'job-1',
      leaseId: 'lease-1',
      revision: sha,
      projection,
    });

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(completed).toMatchObject({ jobId: 'job-1', state: 'synced', completedAt: '2026-09-12T00:01:00.000Z' });
    const savedProjection = calls.find((call) => call.text.includes('INSERT INTO journey_projections'));
    expect(savedProjection?.values).toEqual(['owner-1', 'vault-main', sha, JSON.stringify(projection)]);
    expect(calls.find((call) => call.text.includes('INSERT INTO journey_audit_events'))?.values).toEqual([
      'owner-1',
      'job-1',
      'completed',
      JSON.stringify({ jobId: 'job-1', state: 'synced', revision: sha }),
    ]);
  });

  it('preserves both revisions when a claimed job enters conflict', async () => {
    const expectedRevision = 'b'.repeat(64);
    const actualRevision = 'c'.repeat(64);
    const { repo, calls } = harness((text) => {
      if (text.includes("SET state = $4")) {
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
    const conflict = calls.find((call) => call.text.includes("SET state = $4"));
    expect(conflict?.values).toEqual([
      'owner-1',
      'job-1',
      'lease-1',
      'conflict',
      'revision_conflict',
      expectedRevision,
      actualRevision,
    ]);
    expect(calls.find((call) => call.text.includes('INSERT INTO journey_audit_events'))?.values).toEqual([
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

  it('records an inbound structured projection without putting it in the audit event', async () => {
    const { repo, calls } = harness();
    const projection = { journey: { next: 'Implement claim endpoint' } };

    await repo.recordInboundProjection({
      ownerId: 'owner-1',
      vaultId: 'vault-main',
      revision: sha,
      projection,
    });

    expect(calls.find((call) => call.text.includes('INSERT INTO journey_projections'))?.values).toEqual([
      'owner-1',
      'vault-main',
      sha,
      JSON.stringify(projection),
    ]);
    const audit = calls.find((call) => call.text.includes('INSERT INTO journey_audit_events'));
    expect(audit?.values).toEqual([
      'owner-1',
      null,
      'projection_recorded',
      JSON.stringify({ vaultId: 'vault-main', revision: sha }),
    ]);
    expect(JSON.stringify(audit?.values)).not.toContain('Implement claim endpoint');
  });
});
