import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdmin } from '../middleware/admin';
import type { SyncRepository } from '../modules/journey/syncRepository';
import type { JourneyQuery } from '../modules/journey/syncTypes';
import { createJourneyRouter } from './journey';

const ownerId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const ownerEmail = 'owner@example.com';

/** Shadows the socket address so the request looks like it came from the internet. */
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

describe('hosted journey sync routes', () => {
  const requestSync = vi.fn();
  const enqueueMutation = vi.fn();
  const getProjection = vi.fn();
  const query = vi.fn();
  const notifyOwner = vi.fn();

  beforeEach(() => {
    requestSync.mockReset().mockResolvedValue({ jobId, state: 'pending' });
    enqueueMutation.mockReset().mockResolvedValue({ jobId, state: 'pending' });
    getProjection.mockReset().mockResolvedValue(null);
    query.mockReset().mockResolvedValue({ rows: [] });
    notifyOwner.mockReset().mockResolvedValue(undefined);
  });

  function app(
    user: { userId: string; email: string; role?: 'admin' | 'user' } = {
      userId: ownerId,
      email: ownerEmail,
      role: 'admin',
    },
    overrides: { isBridgeConnected?: (id: string) => boolean } = {},
  ) {
    const instance = express();
    instance.use(express.json());
    instance.use(fromRemoteAddress('203.0.113.7'));
    instance.use(
      '/journey',
      createJourneyRouter({
        mode: 'hosted',
        requireAuth: authAs(user),
        requireAdmin,
        ownerEmail,
        sync: {
          requestSync,
          enqueueMutation,
          getProjection,
        } as unknown as SyncRepository,
        query: query as unknown as JourneyQuery,
        vaultId: 'vault-main',
        notifyOwner,
        isBridgeConnected: overrides.isBridgeConnected,
      }),
    );
    return instance;
  }

  it('lets a non-loopback owner request sync without any vault dependency', async () => {
    const res = await request(app())
      .post('/journey/sync')
      .set('Idempotency-Key', 'sync_12345678')
      .expect(202);

    expect(res.body).toEqual({ jobId, state: 'pending' });
    expect(requestSync).toHaveBeenCalledWith({
      ownerId,
      vaultId: 'vault-main',
      idempotencyKey: 'sync_12345678',
    });
    expect(notifyOwner).toHaveBeenCalledWith(ownerId);
  });

  it('notifies the owner only after the durable job exists', async () => {
    requestSync.mockImplementation(async () => {
      expect(notifyOwner).not.toHaveBeenCalled();
      return { jobId, state: 'pending' };
    });

    await request(app()).post('/journey/sync').set('Idempotency-Key', 'sync_12345678').expect(202);

    expect(notifyOwner).toHaveBeenCalledTimes(1);
  });

  it('still returns the durable job when notification fails', async () => {
    notifyOwner.mockRejectedValue(new Error('bridge unavailable'));

    await request(app()).post('/journey/sync').set('Idempotency-Key', 'sync_12345678').expect(202);
  });

  it('requires an idempotency key', async () => {
    const res = await request(app()).post('/journey/sync').expect(428);

    expect(res.body.code).toBe('idempotency_required');
    expect(requestSync).not.toHaveBeenCalled();
  });

  it('rejects a body carrying a vault path or markdown', async () => {
    await request(app())
      .post('/journey/sync')
      .set('Idempotency-Key', 'sync_12345678')
      .send({ path: '/Users/owner/Daily/2026-09-13.md' })
      .expect(400);

    await request(app())
      .post('/journey/sync')
      .set('Idempotency-Key', 'sync_12345678')
      .send({ markdown: '## private body' })
      .expect(400);

    expect(requestSync).not.toHaveBeenCalled();
  });

  it('denies a non-admin owner', async () => {
    const res = await request(app({ userId: ownerId, email: ownerEmail, role: 'user' }))
      .post('/journey/sync')
      .set('Idempotency-Key', 'sync_12345678')
      .expect(403);

    expect(res.body.code).toBe('admin_required');
    expect(requestSync).not.toHaveBeenCalled();
  });

  it('denies an authenticated user who does not own the vault', async () => {
    const res = await request(app({ userId: ownerId, email: 'other@example.com', role: 'admin' }))
      .post('/journey/sync')
      .set('Idempotency-Key', 'sync_12345678')
      .expect(403);

    expect(res.body.code).toBe('not_vault_owner');
    expect(requestSync).not.toHaveBeenCalled();
  });

  it("returns only the caller's job with bridge connectivity", async () => {
    query.mockImplementation(async (text: string, values: unknown[] = []) => {
      if (text.includes('journey_sync_jobs') && values[0] === ownerId && values[1] === jobId) {
        return {
          rows: [
            {
              id: jobId,
              state: 'synced',
              created_at: '2026-09-13T00:00:00.000Z',
              completed_at: '2026-09-13T00:01:00.000Z',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app(undefined, { isBridgeConnected: () => true }))
      .get(`/journey/sync/${jobId}`)
      .expect(200);

    expect(res.body).toEqual({
      jobId,
      state: 'synced',
      requestedAt: '2026-09-13T00:00:00.000Z',
      completedAt: '2026-09-13T00:01:00.000Z',
      bridgeConnected: true,
    });
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('owner_id = $1');
    expect(sql).toContain('id = $2');
    expect(values).toEqual([ownerId, jobId]);
  });

  it('reports a job as not found for another owner or an unknown id', async () => {
    query.mockImplementation(async (_text: string, values: unknown[] = []) => {
      if (values[1] === '33333333-3333-4333-8333-333333333333') {
        return { rows: [{ id: 'x', state: 'pending', created_at: null, completed_at: null }] };
      }
      return { rows: [] };
    });

    await request(app()).get(`/journey/sync/${jobId}`).expect(404);
  });

  it('rejects a malformed job id without querying', async () => {
    const res = await request(app()).get('/journey/sync/not-a-uuid').expect(404);

    expect(res.body.code).toBe('job_not_found');
    expect(query).not.toHaveBeenCalled();
  });

  it('defaults bridge connectivity to disconnected when no hub is wired', async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: jobId,
          state: 'pending',
          created_at: '2026-09-13T00:00:00.000Z',
          completed_at: null,
        },
      ],
    });

    const res = await request(app()).get(`/journey/sync/${jobId}`).expect(200);

    expect(res.body.bridgeConnected).toBe(false);
  });
});
