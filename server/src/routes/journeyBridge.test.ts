import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createBridgeAuthenticator } from '../modules/journey/bridgeHub';
import type { SyncRepository } from '../modules/journey/syncRepository';
import type { SyncJob } from '../modules/journey/syncTypes';
import { createJourneyBridgeRouter, type JourneyBridgeDependencies } from './journeyBridge';

/** Artificial credential for tests only; never a real bridge token. */
const TEST_TOKEN = 'prepify-bridge-test-credential-0123456789abcdef';
const BASE = '/api/v1/journey/bridge/jobs';
const ownerId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const vaultId = 'vault-main';
const leaseId = 'lease_1234567890abcdef';
const revision = 'a'.repeat(64);
const otherRevision = 'b'.repeat(64);
const sha = `sha256:${revision}`;
const otherSha = `sha256:${otherRevision}`;

const projection = {
  daily: {
    date: '2026-09-13',
    stage: 'AZ-104',
    tasks: [{ id: 'task-1', checked: true, text: 'Review the lab', tags: ['#az104'] }],
    evidence: ['Finished the lab'],
    journal: { done: 'Reviewed', blocked: '', next: 'Practice' },
    blocks: [
      { kind: 'heading', level: 2, text: 'Study' },
      {
        kind: 'list',
        ordered: false,
        items: [{ text: '#az104 21:00 — recall Unit 2', checked: true }],
      },
      {
        kind: 'quote',
        label: 'question',
        title: 'Recall Unit 2',
        lines: ['What is Entra ID?'],
        collapsed: true,
      },
    ],
  },
} as const;

function job(overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    jobId,
    ownerId,
    vaultId,
    type: 'sync',
    payload: {},
    idempotencyKey: 'sync_event_12345678',
    expectedRevision: null,
    state: 'pending',
    leaseId: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    requestedAt: '2026-09-13T00:00:00.000Z',
    completedAt: null,
    failureCode: null,
    conflictExpectedRevision: null,
    conflictActualRevision: null,
    ...overrides,
  };
}

type FakeSync = SyncRepository & {
  listPending: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
  recordInboundProjection: ReturnType<typeof vi.fn>;
};

function fakeSync(overrides: Partial<Record<keyof FakeSync, unknown>> = {}): FakeSync {
  return {
    listPending: vi.fn().mockResolvedValue([job()]),
    claim: vi.fn().mockResolvedValue(job({ state: 'claimed', leaseId })),
    complete: vi
      .fn()
      .mockResolvedValue(job({ state: 'synced', completedAt: '2026-09-13T01:00:00.000Z' })),
    fail: vi.fn().mockResolvedValue(job({ state: 'failed' })),
    recordInboundProjection: vi.fn().mockResolvedValue(job({ state: 'claimed', leaseId })),
    ...overrides,
  } as unknown as FakeSync;
}

/**
 * A browser session cookie would populate `req.user` in the real composition
 * root. Bridge routes must ignore it entirely.
 */
const browserSession: RequestHandler = (req, _res, next) => {
  if ((req.headers.cookie ?? '').includes('prepify_session=')) {
    req.user = { userId: ownerId, email: 'owner@example.com', role: 'admin' };
  }
  next();
};

function bridgeApp(sync: FakeSync) {
  const instance = express();
  instance.use(express.json());
  instance.use(browserSession);
  instance.use(
    BASE,
    createJourneyBridgeRouter({
      authenticate: createBridgeAuthenticator({
        token: TEST_TOKEN,
        resolveOwnerId: async () => ownerId,
      }),
      sync,
      vaultId,
    } satisfies JourneyBridgeDependencies),
  );
  return instance;
}

function bearer<T extends request.Test>(test: T): T {
  return test.set('Authorization', `Bearer ${TEST_TOKEN}`);
}

describe('bridge authentication boundary', () => {
  it('rejects a request with no Authorization header', async () => {
    const sync = fakeSync();
    const res = await request(bridgeApp(sync)).get(`${BASE}/pending`).expect(401);

    expect(res.body.code).toBe('bridge_unauthenticated');
    expect(sync.listPending).not.toHaveBeenCalled();
  });

  it('rejects a request with an invalid bridge token', async () => {
    const sync = fakeSync();
    const res = await request(bridgeApp(sync))
      .get(`${BASE}/pending`)
      .set('Authorization', 'Bearer prepify-bridge-wrong-credential-0123456789')
      .expect(401);

    expect(res.body.code).toBe('bridge_unauthenticated');
    expect(sync.listPending).not.toHaveBeenCalled();
  });

  it('rejects a valid browser session cookie with no bearer token', async () => {
    const sync = fakeSync();
    const res = await request(bridgeApp(sync))
      .get(`${BASE}/pending`)
      .set('Cookie', 'prepify_session=valid-browser-session')
      .expect(401);

    expect(res.body.code).toBe('bridge_unauthenticated');
    expect(sync.listPending).not.toHaveBeenCalled();
  });

  it('authenticates with the bearer token even when a session cookie is present', async () => {
    const sync = fakeSync();
    const res = await bearer(
      request(bridgeApp(sync))
        .get(`${BASE}/pending`)
        .set('Cookie', 'prepify_session=valid-browser-session'),
    ).expect(200);

    expect(res.body.jobs).toHaveLength(1);
    expect(sync.listPending).toHaveBeenCalledWith({ ownerId, vaultId });
  });
});

describe('GET /pending', () => {
  it('returns only structured job descriptors for the authenticated owner', async () => {
    const sync = fakeSync();
    const res = await bearer(request(bridgeApp(sync)).get(`${BASE}/pending`)).expect(200);

    expect(sync.listPending).toHaveBeenCalledWith({ ownerId, vaultId });
    expect(res.body.jobs[0]).toMatchObject({ jobId, vaultId, state: 'pending', type: 'sync' });
    expect(res.body.jobs[0]).not.toHaveProperty('path');
    expect(res.body.jobs[0]).not.toHaveProperty('markdown');
  });

  it('emits sha256-prefixed revisions in the job view', async () => {
    const sync = fakeSync({
      listPending: vi.fn().mockResolvedValue([
        job({
          expectedRevision: revision,
          conflictExpectedRevision: otherRevision,
          conflictActualRevision: revision,
        }),
      ]),
    });
    const res = await bearer(request(bridgeApp(sync)).get(`${BASE}/pending`)).expect(200);

    expect(res.body.jobs[0].expectedRevision).toBe(sha);
    expect(res.body.jobs[0].conflictExpectedRevision).toBe(otherSha);
    expect(res.body.jobs[0].conflictActualRevision).toBe(sha);
  });
});

describe('POST /:id/claim', () => {
  it('claims with the authenticated owner and the submitted lease', async () => {
    const sync = fakeSync();
    const res = await bearer(
      request(bridgeApp(sync)).post(`${BASE}/${jobId}/claim`).send({ leaseId, leaseSeconds: 30 }),
    ).expect(200);

    expect(sync.claim).toHaveBeenCalledWith({ ownerId, jobId, leaseId, leaseSeconds: 30 });
    expect(res.body.job).toMatchObject({ jobId, state: 'claimed', leaseId });
  });

  it('answers 409 when the job is not claimable for this owner', async () => {
    const sync = fakeSync({ claim: vi.fn().mockResolvedValue(null) });
    const res = await bearer(
      request(bridgeApp(sync)).post(`${BASE}/${jobId}/claim`).send({ leaseId, leaseSeconds: 30 }),
    ).expect(409);

    expect(res.body.code).toBe('job_not_claimable');
    expect(sync.claim).toHaveBeenCalledWith({ ownerId, jobId, leaseId, leaseSeconds: 30 });
  });

  it('rejects an out-of-range lease window', async () => {
    const sync = fakeSync();
    await bearer(
      request(bridgeApp(sync)).post(`${BASE}/${jobId}/claim`).send({ leaseId, leaseSeconds: 0 }),
    ).expect(400);
    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/claim`)
        .send({ leaseId, leaseSeconds: 3_600 }),
    ).expect(400);

    expect(sync.claim).not.toHaveBeenCalled();
  });

  it('rejects an unknown field such as a vault path', async () => {
    const sync = fakeSync();
    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/claim`)
        .send({ leaseId, leaseSeconds: 30, path: '/Users/owner/Vault/Daily/2026-09-13.md' }),
    ).expect(400);

    expect(sync.claim).not.toHaveBeenCalled();
  });

  it('rejects an owner identity supplied in the body', async () => {
    const sync = fakeSync();
    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/claim`)
        .send({ leaseId, leaseSeconds: 30, ownerId: '99999999-9999-4999-8999-999999999999' }),
    ).expect(400);

    expect(sync.claim).not.toHaveBeenCalled();
  });

  it('rejects a malformed job identifier', async () => {
    const sync = fakeSync();
    await bearer(
      request(bridgeApp(sync)).post(`${BASE}/not-a-job/claim`).send({ leaseId, leaseSeconds: 30 }),
    ).expect(400);

    expect(sync.claim).not.toHaveBeenCalled();
  });
});

describe('POST /:id/projection', () => {
  const validBody = {
    vaultId,
    leaseId,
    expectedRevision: null,
    revision: sha,
    projection,
  };

  it('records a structured projection and passes canonical revisions to the repository', async () => {
    const sync = fakeSync();
    const res = await bearer(
      request(bridgeApp(sync)).post(`${BASE}/${jobId}/projection`).send(validBody),
    ).expect(200);

    expect(sync.recordInboundProjection).toHaveBeenCalledWith({
      ownerId,
      vaultId,
      jobId,
      leaseId,
      expectedRevision: null,
      revision,
      projection,
    });
    expect(res.body.job).toMatchObject({ jobId, state: 'claimed' });
  });

  it('carries a base revision for an existing projection', async () => {
    const sync = fakeSync();
    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/projection`)
        .send({ ...validBody, expectedRevision: otherSha, revision: sha }),
    ).expect(200);

    expect(sync.recordInboundProjection).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: otherRevision, revision }),
    );
  });

  it('rejects a body carrying raw Markdown under an unknown key', async () => {
    const sync = fakeSync();
    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/projection`)
        .send({ ...validBody, markdown: '# Daily\n\n- [ ] Review' }),
    ).expect(400);

    expect(sync.recordInboundProjection).not.toHaveBeenCalled();
  });

  it('rejects a body carrying a vault path', async () => {
    const sync = fakeSync();
    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/projection`)
        .send({ ...validBody, path: 'Daily/2026-09-13.md' }),
    ).expect(400);

    expect(sync.recordInboundProjection).not.toHaveBeenCalled();
  });

  /**
   * Task text and blocks are display-only — the app never sends them back — so
   * they carry the owner's note verbatim. The fields the bridge splices into
   * the note (evidence, journal) keep rejecting raw Markdown and vault paths.
   */
  it.each([
    ['evidence', { evidence: ['See `Daily/2026-09-13.md` for notes'] }],
    ['journal.done', { journal: { done: 'Daily/2026-09-13.md', blocked: '', next: '' } }],
    ['stage', { stage: 'file:///Users/owner/Daily/2026-09-13.md' }],
  ])('rejects raw Markdown and vault paths smuggled into %s', async (_field, override) => {
    const sync = fakeSync();
    const body = {
      ...validBody,
      projection: { daily: { ...projection.daily, ...override } },
    };

    await bearer(request(bridgeApp(sync)).post(`${BASE}/${jobId}/projection`).send(body)).expect(
      400,
    );
    expect(sync.recordInboundProjection).not.toHaveBeenCalled();
  });

  it('accepts display-only task text a note-splice rule would reject', async () => {
    const sync = fakeSync();
    const body = {
      ...validBody,
      projection: {
        daily: {
          ...projection.daily,
          tasks: [
            {
              id: 'task-1',
              checked: true,
              text: 'đóng vở từ 08/09, Unit 3 recall, Array/Hash Table /7',
              tags: ['#az104'],
            },
          ],
        },
      },
    };

    await bearer(request(bridgeApp(sync)).post(`${BASE}/${jobId}/projection`).send(body)).expect(
      200,
    );
    expect(sync.recordInboundProjection).toHaveBeenCalledTimes(1);
  });

  it('rejects a vault identity for a different vault', async () => {
    const sync = fakeSync();
    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/projection`)
        .send({ ...validBody, vaultId: 'other-vault' }),
    ).expect(400);

    expect(sync.recordInboundProjection).not.toHaveBeenCalled();
  });

  it('reports a revision conflict with revisions and no note content', async () => {
    const sync = fakeSync({
      recordInboundProjection: vi.fn().mockResolvedValue(
        job({
          state: 'conflict',
          failureCode: 'revision_conflict',
          conflictExpectedRevision: otherRevision,
          conflictActualRevision: revision,
        }),
      ),
    });
    const res = await bearer(
      request(bridgeApp(sync)).post(`${BASE}/${jobId}/projection`).send(validBody),
    ).expect(409);

    expect(res.body.code).toBe('revision_conflict');
    expect(res.body).toMatchObject({
      expectedRevision: otherSha,
      actualRevision: sha,
    });
    expect(JSON.stringify(res.body)).not.toContain('journal');
  });

  it('emits sha256-prefixed revisions in the conflict response', async () => {
    const sync = fakeSync({
      recordInboundProjection: vi.fn().mockResolvedValue(
        job({
          state: 'conflict',
          failureCode: 'revision_conflict',
          conflictExpectedRevision: otherRevision,
          conflictActualRevision: revision,
        }),
      ),
    });
    const res = await bearer(
      request(bridgeApp(sync)).post(`${BASE}/${jobId}/projection`).send(validBody),
    ).expect(409);

    expect(res.body.expectedRevision).toBe(otherSha);
    expect(res.body.actualRevision).toBe(sha);
  });

  it('reports a conflict with field names alongside both revisions', async () => {
    const sync = fakeSync({
      recordInboundProjection: vi.fn().mockResolvedValue(
        job({
          state: 'conflict',
          failureCode: 'revision_conflict',
          conflictExpectedRevision: otherRevision,
          conflictActualRevision: revision,
        }),
      ),
    });
    const res = await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/projection`)
        .send({ ...validBody, fields: ['stage', 'journal.done'] }),
    ).expect(409);

    expect(res.body.code).toBe('revision_conflict');
    expect(res.body.fields).toEqual(['stage', 'journal.done']);
  });

  it('answers 404 when no matching claim exists', async () => {
    const sync = fakeSync({ recordInboundProjection: vi.fn().mockResolvedValue(null) });
    const res = await bearer(
      request(bridgeApp(sync)).post(`${BASE}/${jobId}/projection`).send(validBody),
    ).expect(404);

    expect(res.body.code).toBe('job_not_found');
  });
});

describe('POST /:id/complete', () => {
  it('completes a claimed job with a structured projection', async () => {
    const sync = fakeSync();
    const res = await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/complete`)
        .send({ leaseId, revision: sha, projection }),
    ).expect(200);

    expect(sync.complete).toHaveBeenCalledWith({
      ownerId,
      jobId,
      leaseId,
      revision,
      projection,
    });
    expect(res.body.job).toMatchObject({ jobId, state: 'synced' });
  });

  it('reports a revision conflict instead of overwriting', async () => {
    const sync = fakeSync({
      complete: vi.fn().mockResolvedValue(
        job({
          state: 'conflict',
          conflictExpectedRevision: otherRevision,
          conflictActualRevision: revision,
        }),
      ),
    });
    const res = await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/complete`)
        .send({ leaseId, revision: sha, projection }),
    ).expect(409);

    expect(res.body.code).toBe('revision_conflict');
  });

  it('answers 404 when the lease no longer holds the job', async () => {
    const sync = fakeSync({ complete: vi.fn().mockResolvedValue(null) });
    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/complete`)
        .send({ leaseId, revision: sha, projection }),
    ).expect(404);

    expect(sync.complete).toHaveBeenCalledTimes(1);
  });

  it('rejects a raw (unhashed) revision value', async () => {
    const sync = fakeSync();
    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/complete`)
        .send({ leaseId, revision, projection }),
    ).expect(400);

    expect(sync.complete).not.toHaveBeenCalled();
  });

  it('accepts display-only task text a stricter note-splice rule would reject', async () => {
    const sync = fakeSync();
    const day = JSON.parse(JSON.stringify(projection));
    day.daily.tasks[0].text = 'đóng vở từ 08/09, Unit 3 recall, Array/Hash Table /7';

    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/complete`)
        .send({ leaseId, revision: sha, projection: day }),
    ).expect(200);

    expect(sync.complete).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown block kind', async () => {
    const sync = fakeSync();
    const day = JSON.parse(JSON.stringify(projection));
    day.daily.blocks = [{ kind: 'chart', text: 'nope' }];

    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/complete`)
        .send({ leaseId, revision: sha, projection: day }),
    ).expect(400);

    expect(sync.complete).not.toHaveBeenCalled();
  });

  it('rejects a projection without the block key', async () => {
    const sync = fakeSync();
    const day = JSON.parse(JSON.stringify(projection));
    delete day.daily.blocks;

    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/complete`)
        .send({ leaseId, revision: sha, projection: day }),
    ).expect(400);

    expect(sync.complete).not.toHaveBeenCalled();
  });
});

describe('POST /:id/conflict', () => {
  it('records a conflict with both revisions', async () => {
    const sync = fakeSync({
      fail: vi.fn().mockResolvedValue(
        job({
          state: 'conflict',
          conflictExpectedRevision: revision,
          conflictActualRevision: otherRevision,
        }),
      ),
    });
    const res = await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/conflict`)
        .send({ leaseId, expectedRevision: sha, actualRevision: otherSha }),
    ).expect(409);

    expect(sync.fail).toHaveBeenCalledWith({
      ownerId,
      jobId,
      leaseId,
      state: 'conflict',
      errorCode: 'revision_conflict',
      expectedRevision: revision,
      actualRevision: otherRevision,
    });
    expect(res.body).toMatchObject({
      code: 'revision_conflict',
      expectedRevision: sha,
      actualRevision: otherSha,
    });
  });

  it('returns accepted field identifiers in the conflict response', async () => {
    const sync = fakeSync({
      fail: vi.fn().mockResolvedValue(
        job({
          state: 'conflict',
          failureCode: 'revision_conflict',
          conflictExpectedRevision: revision,
          conflictActualRevision: otherRevision,
        }),
      ),
    });
    const res = await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/conflict`)
        .send({
          leaseId,
          expectedRevision: sha,
          actualRevision: otherSha,
          fields: ['journal.done', 'tasks[0].text'],
        }),
    ).expect(409);

    expect(res.body.code).toBe('revision_conflict');
    expect(res.body.fields).toEqual(['journal.done', 'tasks[0].text']);
    expect(sync.fail).toHaveBeenCalledWith({
      ownerId,
      jobId,
      leaseId,
      state: 'conflict',
      errorCode: 'revision_conflict',
      expectedRevision: revision,
      actualRevision: otherRevision,
    });
  });

  it('rejects field entries carrying a path, a URI, whitespace, or note body text', async () => {
    const sync = fakeSync();
    const invalid = [
      ['Daily/2026-09-13.md'],
      ['http://example.com/notes'],
      ['journal done'],
      ['See the vault note for details'],
    ];
    for (const fields of invalid) {
      await bearer(
        request(bridgeApp(sync))
          .post(`${BASE}/${jobId}/conflict`)
          .send({ leaseId, expectedRevision: sha, actualRevision: otherSha, fields }),
      ).expect(400);
    }

    expect(sync.fail).not.toHaveBeenCalled();
  });

  it('requires both revisions', async () => {
    const sync = fakeSync();
    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/conflict`)
        .send({ leaseId, expectedRevision: sha }),
    ).expect(400);
    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/conflict`)
        .send({ leaseId, actualRevision: otherSha }),
    ).expect(400);

    expect(sync.fail).not.toHaveBeenCalled();
  });
});

describe('POST /:id/fail', () => {
  it('records a sanitized failure code', async () => {
    const sync = fakeSync({
      fail: vi.fn().mockResolvedValue(job({ state: 'failed', failureCode: 'vault_write_failed' })),
    });
    const res = await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/fail`)
        .send({ leaseId, errorCode: 'vault_write_failed' }),
    ).expect(200);

    expect(sync.fail).toHaveBeenCalledWith({
      ownerId,
      jobId,
      leaseId,
      state: 'failed',
      errorCode: 'vault_write_failed',
      expectedRevision: undefined,
      actualRevision: undefined,
    });
    expect(res.body.job).toMatchObject({ state: 'failed', failureCode: 'vault_write_failed' });
  });

  it('rejects an unsanitized error code', async () => {
    const sync = fakeSync();
    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/fail`)
        .send({ leaseId, errorCode: 'ENOENT: no such file /Users/owner/Vault' }),
    ).expect(400);

    expect(sync.fail).not.toHaveBeenCalled();
  });

  it('rejects the reserved conflict code on the failure route', async () => {
    const sync = fakeSync();
    await bearer(
      request(bridgeApp(sync))
        .post(`${BASE}/${jobId}/fail`)
        .send({ leaseId, errorCode: 'revision_conflict' }),
    ).expect(400);

    expect(sync.fail).not.toHaveBeenCalled();
  });
});
