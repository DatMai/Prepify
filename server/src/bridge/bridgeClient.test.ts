import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  backoffDelay,
  runBridge,
  type BridgeHandle,
  type BridgeHttp,
  type BridgeVault,
  type BridgeWebSocket,
} from './bridgeClient';
import type { BridgeConfig } from './config';
import { createObsidianVault } from '../services/obsidianVault';
import { parseDaily, revisionFor } from '../services/obsidianMarkdown';

const TOKEN = 'bridge-test-credential-0123456789abcdef0123456789';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const NOTE_DATE = '2026-09-13';

const tempRoots: string[] = [];
const handles: BridgeHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

function sampleNote(date: string): string {
  return `---
type: daily
date: ${date}
updated: 2026-09-08
stage: S0
---
# ${date}

## Study
- [ ] #az104 21:00 — recall Unit 2
- [x] #english #journal 21:45 — close day

## Journal (English only)

- **Done:** first line
- **Blocked:**
- **Next:** continue tomorrow

### Bản sửa

> keep this untouched

## Email

- private content
`;
}

class FakeSocket implements BridgeWebSocket {
  private listeners = new Map<string, Array<(payload?: unknown) => void>>();

  on(event: 'open' | 'close' | 'message' | 'error', listener: (payload?: unknown) => void): void {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
  }

  emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  close(): void {
    this.emit('close');
  }
}

interface FakeRequest {
  method: string;
  path: string;
  body: unknown;
}

function fakeHttp(
  handler: (req: FakeRequest) => Promise<{ status: number; body: unknown }>,
): BridgeHttp & { calls: FakeRequest[] } {
  const calls: FakeRequest[] = [];
  return {
    calls,
    async request(method: 'GET' | 'POST', path: string, body?: unknown) {
      calls.push({ method, path, body });
      return await handler({ method, path, body });
    },
  };
}

async function until(predicate: () => boolean, message: string, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function setup(
  handler: (req: FakeRequest) => Promise<{ status: number; body: unknown }>,
  options: { sleep?: (ms: number) => Promise<void> } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prepify-bridge-client-'));
  tempRoots.push(root);
  const dailyDir = path.join(root, 'Daily');
  await fs.mkdir(dailyDir);
  const notePath = path.join(dailyDir, `${NOTE_DATE}.md`);
  const original = sampleNote(NOTE_DATE);
  await fs.writeFile(notePath, original, 'utf8');

  const realVault = createObsidianVault({ enabled: true, vaultPath: root, timeZone: 'UTC' });
  const vaultCalls: string[] = [];
  const vault: BridgeVault = {
    getJourney: async (date) => {
      vaultCalls.push('getJourney');
      return realVault.getJourney(date);
    },
    updateTask: async (input) => {
      vaultCalls.push('updateTask');
      return realVault.updateTask(input);
    },
    saveJournal: async (input) => {
      vaultCalls.push('saveJournal');
      return realVault.saveJournal(input);
    },
    addEvidence: async (input) => {
      vaultCalls.push('addEvidence');
      return realVault.addEvidence(input);
    },
    addDailySummary: async (input) => {
      vaultCalls.push('addDailySummary');
      return realVault.addDailySummary(input);
    },
  };

  const http = fakeHttp(handler);
  const sockets: FakeSocket[] = [];
  const connections: Array<{ url: string; headers: Record<string, string> }> = [];
  const sleeps: number[] = [];
  const connectWebSocket = (url: string, headers: Record<string, string>) => {
    connections.push({ url, headers });
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };

  const config: BridgeConfig = {
    apiUrl: 'http://bridge.test',
    token: TOKEN,
    vaultPath: root,
    vaultId: 'vault-main',
  };
  const handle = runBridge(config, {
    http,
    connectWebSocket,
    vault,
    sleep:
      options.sleep ??
      (async (ms) => {
        sleeps.push(ms);
      }),
    now: () => new Date('2026-09-13T04:00:00.000Z'),
  });
  handles.push(handle);

  return { root, notePath, original, vaultCalls, http, sockets, connections, sleeps, handle };
}

describe('bridge lifecycle', () => {
  it('opens exactly one authenticated WebSocket and stays idle until opened', async () => {
    const h = await setup(async () => ({ status: 200, body: { jobs: [] } }));

    expect(h.connections).toHaveLength(1);
    expect(h.connections[0].url).toBe('ws://bridge.test/api/v1/journey/bridge');
    expect(h.connections[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    // Idle means idle: no HTTP or vault work before the socket opens.
    expect(h.http.calls).toHaveLength(0);
    expect(h.vaultCalls).toHaveLength(0);

    h.sockets[0].emit('open');
    await until(() => h.http.calls.length > 0, 'pending fetch');

    expect(h.http.calls.filter((c) => c.path.endsWith('/pending'))).toHaveLength(1);
  });

  it('checks pending once, claims a sync job, uploads the projection, and completes', async () => {
    let leaseId: string | null = null;
    const h = await setup(async (req) => {
      if (req.method === 'GET' && req.path.endsWith('/pending')) {
        return { status: 200, body: { jobs: [{ jobId: JOB_ID }] } };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/claim`)) {
        leaseId = (req.body as { leaseId: string }).leaseId;
        return {
          status: 200,
          body: {
            job: {
              jobId: JOB_ID,
              type: 'sync',
              payload: {},
              expectedRevision: null,
              idempotencyKey: 'sync_event_12345678',
              state: 'claimed',
              leaseId,
            },
          },
        };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/complete`)) {
        return { status: 200, body: { job: { jobId: JOB_ID, state: 'synced' } } };
      }
      return { status: 404, body: { error: 'not found', code: 'job_not_found' } };
    });

    h.sockets[0].emit('open');
    await until(
      () => h.http.calls.some((c) => c.method === 'POST' && c.path.endsWith('/complete')),
      'completion',
    );

    const claimCalls = h.http.calls.filter((c) => c.path.endsWith('/claim'));
    expect(claimCalls).toHaveLength(1);
    expect(claimCalls[0].body).toMatchObject({ leaseSeconds: 30 });
    expect(typeof (claimCalls[0].body as { leaseId: string }).leaseId).toBe('string');

    const completeCall = h.http.calls.find((c) => c.path.endsWith('/complete'))!;
    const completeBody = completeCall.body as {
      leaseId: string;
      revision: string;
      projection: { daily: Record<string, unknown> };
    };
    expect(completeBody.leaseId).toBe(leaseId);
    expect(completeBody.revision).toBe(revisionFor(h.original));
    expect(completeBody.projection.daily).toMatchObject({
      date: NOTE_DATE,
      stage: 'S0',
      journal: { done: 'first line', blocked: '', next: 'continue tomorrow' },
    });
    expect(completeBody.projection.daily.tasks).toHaveLength(2);
    expect(completeBody.projection.daily.evidence).toEqual([]);

    // The sync pull is read-only.
    expect(await fs.readFile(h.notePath, 'utf8')).toBe(h.original);
    expect(h.vaultCalls).toEqual(['getJourney']);
    expect(h.http.calls.filter((c) => c.path.endsWith('/pending'))).toHaveLength(1);
  });

  it('completes a sync job delivered by a notification frame', async () => {
    let leaseId: string | null = null;
    const h = await setup(async (req) => {
      if (req.method === 'GET' && req.path.endsWith('/pending')) {
        return { status: 200, body: { jobs: [] } };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/claim`)) {
        leaseId = (req.body as { leaseId: string }).leaseId;
        return {
          status: 200,
          body: {
            job: {
              jobId: JOB_ID,
              type: 'sync',
              payload: {},
              expectedRevision: null,
              idempotencyKey: 'sync_event_12345678',
              state: 'claimed',
              leaseId,
            },
          },
        };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/complete`)) {
        return { status: 200, body: { job: { jobId: JOB_ID, state: 'synced' } } };
      }
      return { status: 404, body: { error: 'not found', code: 'job_not_found' } };
    });

    h.sockets[0].emit('open');
    await until(
      () => h.http.calls.some((c) => c.method === 'GET' && c.path.endsWith('/pending')),
      'pending fetch',
    );
    h.sockets[0].emit('message', JSON.stringify({ type: 'sync_available', jobIds: [JOB_ID] }));
    await until(
      () => h.http.calls.some((c) => c.method === 'POST' && c.path.endsWith('/complete')),
      'completion',
    );

    const completeCall = h.http.calls.find((c) => c.path.endsWith('/complete'))!;
    const completeBody = completeCall.body as {
      leaseId: string;
      revision: string;
      projection: { daily: { date: string } };
    };
    expect(completeBody.leaseId).toBe(leaseId);
    expect(completeBody.revision).toBe(revisionFor(h.original));
    expect(completeBody.projection.daily.date).toBe(NOTE_DATE);
    expect(h.vaultCalls).toEqual(['getJourney']);
    expect(await fs.readFile(h.notePath, 'utf8')).toBe(h.original);
  });

  it('applies an outbound task mutation from a notification and completes', async () => {
    const taskId = parseDaily(sampleNote(NOTE_DATE)).tasks[0].id;
    const h = await setup(async (req) => {
      if (req.method === 'GET' && req.path.endsWith('/pending')) {
        return { status: 200, body: { jobs: [] } };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/claim`)) {
        return {
          status: 200,
          body: {
            job: {
              jobId: JOB_ID,
              type: 'mutation',
              payload: {
                operation: 'journey_mutation',
                payload: {
                  kind: 'task',
                  date: NOTE_DATE,
                  taskId,
                  completed: true,
                  evidence: '#az104 #recall — done',
                },
              },
              expectedRevision: revisionFor(sampleNote(NOTE_DATE)),
              idempotencyKey: 'event_task_12345678',
              state: 'claimed',
              leaseId: 'lease-1',
            },
          },
        };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/complete`)) {
        return { status: 200, body: { job: { jobId: JOB_ID, state: 'synced' } } };
      }
      return { status: 404, body: { error: 'not found', code: 'job_not_found' } };
    });

    h.sockets[0].emit('open');
    await until(
      () => h.http.calls.some((c) => c.method === 'GET' && c.path.endsWith('/pending')),
      'pending fetch',
    );
    h.sockets[0].emit('message', JSON.stringify({ type: 'sync_available', jobIds: [JOB_ID] }));
    await until(
      () => h.http.calls.some((c) => c.method === 'POST' && c.path.endsWith('/complete')),
      'completion',
    );

    const stored = await fs.readFile(h.notePath, 'utf8');
    expect(stored).toMatch(/- \[x\] #az104 21:00 — recall Unit 2/);

    const completeCall = h.http.calls.find((c) => c.path.endsWith('/complete'))!;
    const completeBody = completeCall.body as {
      projection: { daily: { tasks: Array<{ id: string; checked: boolean }> } };
    };
    expect(completeBody.projection.daily.tasks.find((t) => t.id === taskId)?.checked).toBe(true);
    expect(h.vaultCalls).toEqual(['updateTask']);
  });

  it('applies a daily summary mutation and completes', async () => {
    const h = await setup(async (req) => {
      if (req.method === 'GET' && req.path.endsWith('/pending')) {
        return { status: 200, body: { jobs: [] } };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/claim`)) {
        return {
          status: 200,
          body: {
            job: {
              jobId: JOB_ID,
              type: 'mutation',
              payload: {
                operation: 'daily_summary',
                payload: { date: NOTE_DATE, score: 3, total: 5 },
              },
              expectedRevision: null,
              idempotencyKey: 'daily_2026-09-13_owner',
              state: 'claimed',
              leaseId: 'lease-1',
            },
          },
        };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/complete`)) {
        return { status: 200, body: { job: { jobId: JOB_ID, state: 'synced' } } };
      }
      return { status: 404, body: { error: 'not found', code: 'job_not_found' } };
    });

    h.sockets[0].emit('open');
    await until(
      () => h.http.calls.some((c) => c.method === 'GET' && c.path.endsWith('/pending')),
      'pending fetch',
    );
    h.sockets[0].emit('message', JSON.stringify({ type: 'sync_available', jobIds: [JOB_ID] }));
    await until(
      () => h.http.calls.some((c) => c.method === 'POST' && c.path.endsWith('/complete')),
      'completion',
    );

    const stored = await fs.readFile(h.notePath, 'utf8');
    expect(stored).toContain('Daily quiz — 3/5');
    expect(stored.match(/prepify:event/g) ?? []).toHaveLength(1);
    expect(h.vaultCalls).toEqual(['addDailySummary']);
  });

  it('processes duplicate notifications for the same job exactly once', async () => {
    const taskId = parseDaily(sampleNote(NOTE_DATE)).tasks[0].id;
    const h = await setup(async (req) => {
      if (req.method === 'GET' && req.path.endsWith('/pending')) {
        return { status: 200, body: { jobs: [{ jobId: JOB_ID }] } };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/claim`)) {
        return {
          status: 200,
          body: {
            job: {
              jobId: JOB_ID,
              type: 'mutation',
              payload: {
                operation: 'journey_mutation',
                payload: {
                  kind: 'task',
                  date: NOTE_DATE,
                  taskId,
                  completed: true,
                  evidence: '#once — done',
                },
              },
              expectedRevision: revisionFor(sampleNote(NOTE_DATE)),
              idempotencyKey: 'event_once_12345678',
              state: 'claimed',
              leaseId: 'lease-1',
            },
          },
        };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/complete`)) {
        return { status: 200, body: { job: { jobId: JOB_ID, state: 'synced' } } };
      }
      return { status: 404, body: { error: 'not found', code: 'job_not_found' } };
    });

    h.sockets[0].emit('open');
    h.sockets[0].emit('message', JSON.stringify({ type: 'sync_available', jobIds: [JOB_ID] }));
    h.sockets[0].emit('message', JSON.stringify({ type: 'sync_available', jobIds: [JOB_ID] }));
    await until(
      () => h.http.calls.filter((c) => c.path.endsWith('/complete')).length >= 1,
      'completion',
    );
    // Give any queued duplicate a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(h.http.calls.filter((c) => c.path.endsWith('/claim'))).toHaveLength(1);
    expect(h.http.calls.filter((c) => c.path.endsWith('/complete'))).toHaveLength(1);
    const stored = await fs.readFile(h.notePath, 'utf8');
    expect(stored.match(/prepify:event/g) ?? []).toHaveLength(1);
  });

  it('reconnects after a close and re-checks pending once per connection', async () => {
    let pendingCalls = 0;
    const h = await setup(async (req) => {
      if (req.method === 'GET' && req.path.endsWith('/pending')) {
        pendingCalls += 1;
        return { status: 200, body: { jobs: [] } };
      }
      return { status: 404, body: { error: 'not found', code: 'job_not_found' } };
    });

    h.sockets[0].emit('open');
    await until(() => pendingCalls === 1, 'first pending fetch');

    h.sockets[0].emit('close');
    await until(() => h.sockets.length >= 2, 'reconnect');
    expect(h.sleeps).toEqual([1_000]);

    h.sockets[1].emit('open');
    await until(() => pendingCalls === 2, 'second pending fetch');
    expect(pendingCalls).toBe(2);
  });

  it('retries failed connections with bounded exponential backoff', async () => {
    const sleeps: number[] = [];
    const sockets: FakeSocket[] = [];
    const config: BridgeConfig = {
      apiUrl: 'http://bridge.test',
      token: TOKEN,
      vaultPath: '/tmp/irrelevant',
      vaultId: 'vault-main',
    };
    const noopVault: BridgeVault = {
      getJourney: async () => {
        throw new Error('unused');
      },
      updateTask: async () => {
        throw new Error('unused');
      },
      saveJournal: async () => {
        throw new Error('unused');
      },
      addEvidence: async () => {
        throw new Error('unused');
      },
      addDailySummary: async () => {
        throw new Error('unused');
      },
    };
    const handle = runBridge(config, {
      http: { request: async () => ({ status: 500, body: {} }) },
      connectWebSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        setTimeout(() => socket.emit('close'), 0);
        return socket;
      },
      vault: noopVault,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    handles.push(handle);

    await until(() => sleeps.length >= 4, 'four backoff sleeps');
    expect(sleeps.slice(0, 4)).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it('caps the reconnect backoff', () => {
    expect(backoffDelay(0)).toBe(1_000);
    expect(backoffDelay(1)).toBe(2_000);
    expect(backoffDelay(5)).toBe(30_000);
    expect(backoffDelay(10)).toBe(30_000);
  });

  it('reports a conflict instead of overwriting when the expected revision is stale', async () => {
    const taskId = parseDaily(sampleNote(NOTE_DATE)).tasks[0].id;
    const staleSha = `sha256:${'a'.repeat(64)}`;
    const h = await setup(async (req) => {
      if (req.method === 'GET' && req.path.endsWith('/pending')) {
        return { status: 200, body: { jobs: [] } };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/claim`)) {
        return {
          status: 200,
          body: {
            job: {
              jobId: JOB_ID,
              type: 'mutation',
              payload: {
                operation: 'journey_mutation',
                payload: {
                  kind: 'task',
                  date: NOTE_DATE,
                  taskId,
                  completed: true,
                  evidence: '#stale — x',
                },
              },
              expectedRevision: staleSha,
              idempotencyKey: 'event_stale_12345678',
              state: 'claimed',
              leaseId: 'lease-1',
            },
          },
        };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/conflict`)) {
        return { status: 409, body: { code: 'revision_conflict' } };
      }
      return { status: 404, body: { error: 'not found', code: 'job_not_found' } };
    });

    h.sockets[0].emit('open');
    await until(
      () => h.http.calls.some((c) => c.method === 'GET' && c.path.endsWith('/pending')),
      'pending fetch',
    );
    h.sockets[0].emit('message', JSON.stringify({ type: 'sync_available', jobIds: [JOB_ID] }));
    await until(
      () => h.http.calls.some((c) => c.method === 'POST' && c.path.endsWith('/conflict')),
      'conflict report',
    );

    const conflictCall = h.http.calls.find((c) => c.path.endsWith('/conflict'))!;
    const conflictBody = conflictCall.body as {
      leaseId: string;
      expectedRevision: string;
      actualRevision: string;
    };
    expect(conflictBody.expectedRevision).toBe(staleSha);
    expect(conflictBody.actualRevision).toBe(revisionFor(h.original));

    expect(await fs.readFile(h.notePath, 'utf8')).toBe(h.original);
    expect(h.http.calls.some((c) => c.path.endsWith('/complete'))).toBe(false);
  });

  it('survives an offline API and resumes pending work on the next connection', async () => {
    let online = false;
    const taskId = parseDaily(sampleNote(NOTE_DATE)).tasks[0].id;
    const h = await setup(async (req) => {
      if (!online) throw new Error('network down');
      if (req.method === 'GET' && req.path.endsWith('/pending')) {
        return { status: 200, body: { jobs: [{ jobId: JOB_ID }] } };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/claim`)) {
        return {
          status: 200,
          body: {
            job: {
              jobId: JOB_ID,
              type: 'mutation',
              payload: {
                operation: 'journey_mutation',
                payload: {
                  kind: 'task',
                  date: NOTE_DATE,
                  taskId,
                  completed: true,
                  evidence: '#resume — done',
                },
              },
              expectedRevision: revisionFor(sampleNote(NOTE_DATE)),
              idempotencyKey: 'event_resume_12345678',
              state: 'claimed',
              leaseId: 'lease-1',
            },
          },
        };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/complete`)) {
        return { status: 200, body: { job: { jobId: JOB_ID, state: 'synced' } } };
      }
      return { status: 404, body: { error: 'not found', code: 'job_not_found' } };
    });

    h.sockets[0].emit('open');
    await until(
      () => h.http.calls.some((c) => c.method === 'GET' && c.path.endsWith('/pending')),
      'offline pending fetch attempt',
    );
    h.sockets[0].emit('message', JSON.stringify({ type: 'sync_available', jobIds: [JOB_ID] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.http.calls.some((c) => c.path.endsWith('/complete'))).toBe(false);

    online = true;
    h.sockets[0].emit('close');
    await until(() => h.sockets.length >= 2, 'reconnect after offline period');
    h.sockets[1].emit('open');
    await until(
      () => h.http.calls.filter((c) => c.path.endsWith('/complete')).length >= 1,
      'resumed completion',
    );

    expect(h.http.calls.filter((c) => c.path.endsWith('/complete'))).toHaveLength(1);
    expect(await fs.readFile(h.notePath, 'utf8')).toMatch(/- \[x\] #az104/);
  });

  it('ignores a claim that is no longer claimable without failing', async () => {
    const h = await setup(async (req) => {
      if (req.method === 'GET' && req.path.endsWith('/pending')) {
        return { status: 200, body: { jobs: [] } };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/claim`)) {
        return { status: 409, body: { error: 'not claimable', code: 'job_not_claimable' } };
      }
      return { status: 404, body: { error: 'not found', code: 'job_not_found' } };
    });

    h.sockets[0].emit('open');
    await until(
      () => h.http.calls.some((c) => c.method === 'GET' && c.path.endsWith('/pending')),
      'pending fetch',
    );
    h.sockets[0].emit('message', JSON.stringify({ type: 'sync_available', jobIds: [JOB_ID] }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(h.http.calls.filter((c) => c.path.endsWith('/fail'))).toHaveLength(0);
    expect(h.http.calls.filter((c) => c.path.endsWith('/complete'))).toHaveLength(0);
    expect(h.vaultCalls).toHaveLength(0);
  });

  it('fails a sync job with a sanitized code instead of looping when a parsed tag is too long', async () => {
    const longTag = `#${'a'.repeat(81)}`; // 82 characters, beyond the server's 80-character cap
    const h = await setup(async (req) => {
      if (req.method === 'GET' && req.path.endsWith('/pending')) {
        return { status: 200, body: { jobs: [{ jobId: JOB_ID }] } };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/claim`)) {
        return {
          status: 200,
          body: {
            job: {
              jobId: JOB_ID,
              type: 'sync',
              payload: {},
              expectedRevision: null,
              idempotencyKey: 'sync_event_12345678',
              state: 'claimed',
              leaseId: 'lease-1',
            },
          },
        };
      }
      if (req.method === 'POST' && req.path.endsWith(`/${JOB_ID}/fail`)) {
        return { status: 200, body: { job: { jobId: JOB_ID, state: 'failed' } } };
      }
      return { status: 404, body: { error: 'not found', code: 'job_not_found' } };
    });
    // A note the owner wrote with an over-long tag: the server would 400 on
    // /complete, so the bridge must not build that projection at all.
    await fs.writeFile(h.notePath, sampleNote(NOTE_DATE).replace('#az104', longTag), 'utf8');

    h.sockets[0].emit('open');
    await until(
      () => h.http.calls.some((c) => c.method === 'POST' && c.path.endsWith('/fail')),
      'failure report',
    );

    const failCall = h.http.calls.find((c) => c.path.endsWith('/fail'))!;
    expect(failCall.body).toMatchObject({ errorCode: 'invalid_vault_tag' });
    expect(typeof (failCall.body as { leaseId: unknown }).leaseId).toBe('string');
    // The owner's own content is never echoed back into the failure report.
    expect(JSON.stringify(failCall.body)).not.toContain('aaaa');
    expect(h.http.calls.some((c) => c.path.endsWith('/complete'))).toBe(false);
  });
});
