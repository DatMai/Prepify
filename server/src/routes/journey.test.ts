import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdmin } from '../middleware/admin';
import type { ObsidianVault } from '../services/obsidianVault';
import type { SyncRepository } from '../modules/journey/syncRepository';
import type { JourneyQuery } from '../modules/journey/syncTypes';
import { createJourneyRouter } from './journey';

const ownerId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const ownerEmail = 'owner@example.com';
const revision = 'a'.repeat(64);

function fromRemoteAddress(address: string): RequestHandler {
  return (req, _res, next) => {
    Object.defineProperty(req.socket, 'remoteAddress', { value: address, configurable: true });
    next();
  };
}

function authAs(user: { userId: string; email: string; role?: 'admin' | 'user' }): RequestHandler {
  return (req, _res, next) => {
    req.user = user;
    next();
  };
}

const snapshot = {
  date: '2026-09-13',
  revision: `sha256:${revision}`,
  mtimeMs: 1,
  obsidianUri: 'obsidian://open?vault=vault-main&file=Daily%2F2026-09-13.md',
  stage: 'AZ-104',
  tasks: [],
  evidence: [],
  journal: { done: '', blocked: '', next: '' },
};

function localApp(vault: ObsidianVault, remoteAddress = '127.0.0.1') {
  const instance = express();
  instance.use(express.json());
  instance.use(fromRemoteAddress(remoteAddress));
  instance.use(
    '/journey',
    createJourneyRouter({
      mode: 'local',
      requireAuth: authAs({ userId: ownerId, email: ownerEmail, role: 'admin' }),
      requireAdmin,
      ownerEmail,
      vault,
    }),
  );
  return instance;
}

function vault(overrides: Partial<ObsidianVault> = {}): ObsidianVault {
  return {
    getTodayJourney: vi.fn().mockResolvedValue(snapshot),
    updateTodayTask: vi.fn().mockResolvedValue(snapshot),
    saveTodayJournal: vi.fn().mockResolvedValue(snapshot),
    addTodayEvidence: vi.fn().mockResolvedValue(snapshot),
    ...overrides,
  } as unknown as ObsidianVault;
}

describe('local trusted journey routes', () => {
  it('serves today from the vault for a loopback admin owner', async () => {
    const getTodayJourney = vi.fn().mockResolvedValue(snapshot);

    const res = await request(localApp(vault({ getTodayJourney })))
      .get('/journey/today')
      .expect(200);

    expect(res.body.date).toBe('2026-09-13');
    expect(getTodayJourney).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-loopback request before it can reach the vault', async () => {
    const getTodayJourney = vi.fn().mockResolvedValue(snapshot);

    const res = await request(localApp(vault({ getTodayJourney }), '203.0.113.7'))
      .get('/journey/today')
      .expect(403);

    expect(res.body.code).toBe('local_only');
    expect(getTodayJourney).not.toHaveBeenCalled();
  });
});

describe('hosted journey routes', () => {
  const requestSync = vi.fn();
  const enqueueMutation = vi.fn();
  const getProjection = vi.fn();

  beforeEach(() => {
    requestSync.mockReset().mockResolvedValue({ jobId, state: 'pending' });
    enqueueMutation.mockReset().mockResolvedValue({ jobId, state: 'pending' });
    getProjection.mockReset().mockResolvedValue(null);
  });

  function app(isBridgeConnected?: (ownerId: string) => boolean) {
    const instance = express();
    instance.use(express.json());
    instance.use(fromRemoteAddress('203.0.113.7'));
    instance.use(
      '/journey',
      createJourneyRouter({
        mode: 'hosted',
        requireAuth: authAs({ userId: ownerId, email: ownerEmail, role: 'admin' }),
        requireAdmin,
        ownerEmail,
        sync: {
          requestSync,
          enqueueMutation,
          getProjection,
        } as unknown as SyncRepository,
        query: vi.fn() as unknown as JourneyQuery,
        vaultId: 'vault-main',
        isBridgeConnected,
      }),
    );
    return instance;
  }

  it('reads the stored projection without touching a vault', async () => {
    getProjection.mockResolvedValue({
      ownerId,
      vaultId: 'vault-main',
      revision,
      updatedAt: '2026-09-13T00:00:00.000Z',
      projection: {
        daily: {
          date: '2026-09-13',
          stage: 'AZ-104',
          tasks: [{ id: 'task-1', checked: true, text: 'Review', tags: ['#az104'] }],
          evidence: [],
          journal: { done: 'Reviewed', blocked: '', next: 'Practice' },
        },
      },
    });

    const res = await request(app()).get('/journey/today').expect(200);

    expect(res.body).toMatchObject({ synced: true, date: '2026-09-13', revision });
    expect(res.body.projection.daily.tasks[0]).toMatchObject({ id: 'task-1', checked: true });
    expect(getProjection).toHaveBeenCalledWith({ ownerId, vaultId: 'vault-main' });
  });

  it('reports an unsynced journey when no projection exists', async () => {
    const res = await request(app()).get('/journey/today').expect(200);

    expect(res.body).toEqual({ synced: false, bridgeConnected: false });
  });

  it('reports the projection with bridge connectivity so the UI can reconcile', async () => {
    getProjection.mockResolvedValue({
      ownerId,
      vaultId: 'vault-main',
      revision,
      updatedAt: '2026-09-13T09:00:00.000Z',
      projection: {
        daily: {
          date: '2026-09-13',
          stage: 'AZ-104',
          tasks: [],
          evidence: [],
          journal: { done: '', blocked: '', next: '' },
          blocks: [],
        },
      },
    });

    const res = await request(app(() => true))
      .get('/journey/today')
      .expect(200);

    expect(res.body).toMatchObject({ synced: true, bridgeConnected: true });
    expect(res.body.updatedAt).toBe('2026-09-13T09:00:00.000Z');
  });

  it('enqueues a structured task mutation instead of writing a note', async () => {
    const res = await request(app())
      .patch('/journey/today/tasks/task-1')
      .set('If-Match', revision)
      .set('Idempotency-Key', 'task_event_12345678')
      .send({ completed: true, evidence: 'Finished the lab' })
      .expect(202);

    expect(res.body).toEqual({ jobId, state: 'pending' });
    expect(enqueueMutation).toHaveBeenCalledTimes(1);
    const input = enqueueMutation.mock.calls[0][0];
    expect(input).toMatchObject({
      ownerId,
      vaultId: 'vault-main',
      idempotencyKey: 'task_event_12345678',
      operation: 'journey_mutation',
      expectedRevision: revision,
    });
    expect(input.payload).toMatchObject({
      kind: 'task',
      taskId: 'task-1',
      completed: true,
      evidence: 'Finished the lab',
    });
    expect(input.payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input).not.toHaveProperty('path');
    expect(input.payload).not.toHaveProperty('markdown');
  });

  it('rejects a mutation body that carries a vault path or markdown', async () => {
    await request(app())
      .patch('/journey/today/tasks/task-1')
      .set('If-Match', revision)
      .set('Idempotency-Key', 'task_event_12345678')
      .send({ completed: true, path: '/Users/owner/Daily/2026-09-13.md' })
      .expect(400);

    await request(app())
      .put('/journey/today/journal')
      .set('If-Match', revision)
      .send({ done: 'a', blocked: 'b', next: 'c', markdown: '# raw' })
      .expect(400);

    expect(enqueueMutation).not.toHaveBeenCalled();
  });

  it('requires a revision for a mutation', async () => {
    const res = await request(app())
      .patch('/journey/today/tasks/task-1')
      .set('Idempotency-Key', 'task_event_12345678')
      .send({ completed: true })
      .expect(428);

    expect(res.body.code).toBe('revision_required');
  });

  it('enqueues journal and evidence mutations as canonical structured payloads', async () => {
    await request(app())
      .put('/journey/today/journal')
      .set('If-Match', revision)
      .set('Idempotency-Key', 'journal_event_1234')
      .send({ done: 'Shipped the route', blocked: '', next: 'Write tests' })
      .expect(202);

    await request(app())
      .post('/journey/today/evidence')
      .set('If-Match', revision)
      .set('Idempotency-Key', 'evidence_event_1234')
      .send({ evidence: 'Closed three review threads' })
      .expect(202);

    expect(enqueueMutation.mock.calls[0][0].payload).toMatchObject({
      kind: 'journal',
      done: 'Shipped the route',
      next: 'Write tests',
    });
    expect(enqueueMutation.mock.calls[1][0].payload).toMatchObject({
      kind: 'evidence',
      evidence: 'Closed three review threads',
    });
  });
});
