import { randomUUID } from 'node:crypto';
import { dateInTimeZone, VaultError, type JourneySnapshot } from '../services/obsidianVault';
import type { JourneyJournal } from '../services/obsidianMarkdown';
import { bridgeWsUrl, type BridgeConfig } from './config';

const BRIDGE_JOBS_PATH = '/api/v1/journey/bridge/jobs';
const BRIDGE_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const LEASE_SECONDS = 30;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export interface BridgeHttpResponse {
  status: number;
  body: unknown;
}

export interface BridgeHttp {
  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<BridgeHttpResponse>;
}

export interface BridgeWebSocket {
  on(event: 'open' | 'close' | 'message' | 'error', listener: (payload?: unknown) => void): void;
  close(): void;
}

export interface BridgeLogger {
  info?(input: unknown, message?: string): void;
  warn?(input: unknown, message?: string): void;
  error?(input: unknown, message?: string): void;
}

/** The narrow allowlisted surface of the vault adapter the bridge is allowed to use. */
export interface BridgeVault {
  getJourney(date: string): Promise<JourneySnapshot>;
  updateTask(input: {
    date: string;
    taskId: string;
    completed: boolean;
    evidence?: string;
    expectedRevision: string;
    eventId?: string;
  }): Promise<JourneySnapshot>;
  saveJournal(input: {
    date: string;
    journal: JourneyJournal;
    expectedRevision: string;
  }): Promise<JourneySnapshot>;
  addEvidence(input: {
    date: string;
    evidence: string;
    expectedRevision: string;
    eventId: string;
  }): Promise<JourneySnapshot>;
  addDailySummary(input: {
    date: string;
    score: number;
    total: number;
    eventId: string;
    /** Mirrors `ObsidianVault.addDailySummary`: guarded when the job recorded an expectation. */
    expectedRevision?: string | null;
  }): Promise<JourneySnapshot>;
}

export interface BridgeDependencies {
  http: BridgeHttp;
  connectWebSocket: (url: string, headers: Record<string, string>) => BridgeWebSocket;
  vault: BridgeVault;
  logger?: BridgeLogger;
  randomId?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}

export interface BridgeHandle {
  close(): Promise<void>;
}

/** Bounded exponential backoff: 1s, 2s, 4s, … capped at 30s. */
export function backoffDelay(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, Math.floor(attempt)));
}

interface ClaimedJob {
  jobId: string;
  type: 'sync' | 'mutation';
  payload: { operation?: unknown; payload?: Record<string, unknown> } | Record<string, never>;
  expectedRevision: string | null;
  idempotencyKey: string;
}

const SAFE_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Mirrors `journey_json_is_tag` in migration 013 and `TAG` in
 * `server/src/routes/journeyBridge.ts`. The bridge refuses to build a
 * projection the server would reject with a 400 — otherwise a note the owner
 * wrote with an over-long tag would loop forever on lease-expiry re-delivery.
 * The offending tag is never logged or echoed back: only this bounded code.
 */
const TAG = /^#[^#/\\*`<>\s]{1,80}$/;
const INVALID_TAG_ERROR = 'invalid_vault_tag';

function hasInvalidTag(snapshot: JourneySnapshot): boolean {
  return snapshot.tasks.some((task) => task.tags.some((tag) => !TAG.test(tag)));
}

function sanitizeErrorCode(code: string): string {
  if (code === 'revision_conflict' || !SAFE_ERROR_CODE.test(code)) return 'bridge_job_failed';
  return code;
}

/**
 * Runs the bridge until `close()` is called. The bridge opens exactly one
 * outbound WebSocket, performs no filesystem work while idle, checks pending
 * jobs once after each successful connection, and claims/applies/acknowledges
 * each job exactly once. Job idempotency stays server-owned: the bridge only
 * deduplicates in-flight work and lets a re-claim of an already-handled job 409.
 */
export function runBridge(config: BridgeConfig, deps: BridgeDependencies): BridgeHandle {
  const randomId = deps.randomId ?? randomUUID;
  const sleep =
    deps.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const log = deps.logger;

  const inFlight = new Set<string>();
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;
  let socket: BridgeWebSocket | null = null;
  let reconnectInFlight = false;
  let attempt = 0;

  function jobsUrl(jobId: string): string {
    return `${BRIDGE_JOBS_PATH}/${jobId}`;
  }

  async function safeRequest(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<BridgeHttpResponse | null> {
    try {
      return await deps.http.request(method, path, body);
    } catch (error) {
      log?.warn?.({ err: error, path }, 'bridge request failed');
      return null;
    }
  }

  function enqueueJob(jobId: string): void {
    if (inFlight.has(jobId)) return;
    inFlight.add(jobId);
    queue = queue
      .then(() => processJobOnce(jobId))
      .catch((error) => {
        log?.error?.({ err: error, jobId }, 'bridge job processing failed');
      })
      .finally(() => {
        inFlight.delete(jobId);
      });
  }

  function handleFrame(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const frame = parsed as { type?: unknown; jobIds?: unknown };
    if (frame.type !== 'sync_available' || !Array.isArray(frame.jobIds)) return;
    for (const id of frame.jobIds) {
      if (typeof id === 'string') enqueueJob(id);
    }
  }

  async function drainPending(): Promise<void> {
    const res = await safeRequest('GET', `${BRIDGE_JOBS_PATH}/pending`);
    if (!res || res.status !== 200) return;
    const jobs = (res.body as { jobs?: Array<{ jobId?: unknown }> } | null | undefined)?.jobs ?? [];
    for (const job of jobs) {
      if (typeof job?.jobId === 'string') enqueueJob(job.jobId);
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectInFlight) return;
    reconnectInFlight = true;
    const delay = backoffDelay(attempt);
    attempt = Math.min(attempt + 1, 5);
    void sleep(delay).then(() => {
      reconnectInFlight = false;
      if (stopped) return;
      openConnection();
    });
  }

  function openConnection(): void {
    if (stopped) return;
    let nextSocket: BridgeWebSocket;
    try {
      nextSocket = deps.connectWebSocket(bridgeWsUrl(config.apiUrl), {
        Authorization: `Bearer ${config.token}`,
      });
    } catch (error) {
      log?.warn?.({ err: error }, 'bridge connect failed');
      scheduleReconnect();
      return;
    }
    socket = nextSocket;
    nextSocket.on('open', () => {
      attempt = 0;
      void drainPending();
    });
    nextSocket.on('message', (payload) => {
      // A Node `ws` client hands a text frame over as a Buffer with
      // `isBinary === false`, not as a string. Accepting only strings silently
      // discarded every notification the hub sent, so the bridge worked once on
      // connect and then never again.
      const frame =
        typeof payload === 'string'
          ? payload
          : Buffer.isBuffer(payload)
            ? payload.toString('utf8')
            : null;
      if (frame !== null) handleFrame(frame);
    });
    nextSocket.on('error', (payload) => {
      log?.warn?.({ err: payload }, 'bridge socket error');
    });
    nextSocket.on('close', () => {
      if (socket === nextSocket) socket = null;
      scheduleReconnect();
    });
  }

  async function processJobOnce(jobId: string): Promise<void> {
    const leaseId = `bridge_${randomId()}`;
    const claim = await safeRequest('POST', `${jobsUrl(jobId)}/claim`, {
      leaseId,
      leaseSeconds: LEASE_SECONDS,
    });
    // A 409 means the job is already claimed or finished; never treat it as a failure.
    if (!claim || claim.status === 409) return;
    if (claim.status !== 200) return;

    const claimed = (claim.body as { job?: ClaimedJob } | null | undefined)?.job;
    if (!claimed) return;

    try {
      if (claimed.type === 'sync') {
        await applySyncPull(jobId, leaseId);
      } else if (claimed.type === 'mutation') {
        await applyMutationPush(jobId, leaseId, claimed);
      } else {
        await safeRequest('POST', `${jobsUrl(jobId)}/fail`, {
          leaseId,
          errorCode: 'unsupported_job_type',
        });
      }
    } catch (error) {
      log?.error?.({ err: error, jobId }, 'bridge job failed');
      await safeRequest('POST', `${jobsUrl(jobId)}/fail`, {
        leaseId,
        errorCode: 'bridge_job_failed',
      });
    }
  }

  function projectionOf(snapshot: JourneySnapshot) {
    return {
      daily: {
        date: snapshot.date,
        stage: snapshot.stage,
        tasks: snapshot.tasks,
        evidence: snapshot.evidence,
        journal: snapshot.journal,
      },
    };
  }

  /**
   * Uploads a snapshot as the structured projection. If the snapshot carries a
   * tag the server's contract rejects, the job fails with a bounded code
   * instead of building a projection that would 400 and re-deliver forever.
   * Truncating or dropping the tag is never an option — it is the owner's data.
   */
  async function completeProjection(
    jobId: string,
    leaseId: string,
    snapshot: JourneySnapshot,
  ): Promise<void> {
    if (hasInvalidTag(snapshot)) {
      await safeRequest('POST', `${jobsUrl(jobId)}/fail`, {
        leaseId,
        errorCode: INVALID_TAG_ERROR,
      });
      return;
    }
    await safeRequest('POST', `${jobsUrl(jobId)}/complete`, {
      leaseId,
      revision: snapshot.revision,
      projection: projectionOf(snapshot),
    });
  }

  async function applySyncPull(jobId: string, leaseId: string): Promise<void> {
    const date = dateInTimeZone(deps.now?.() ?? new Date(), BRIDGE_TIME_ZONE);
    let snapshot: JourneySnapshot;
    try {
      snapshot = await deps.vault.getJourney(date);
    } catch (error) {
      if (error instanceof VaultError) {
        await safeRequest('POST', `${jobsUrl(jobId)}/fail`, {
          leaseId,
          errorCode: sanitizeErrorCode(error.code),
        });
        return;
      }
      await safeRequest('POST', `${jobsUrl(jobId)}/fail`, {
        leaseId,
        errorCode: 'vault_read_failed',
      });
      return;
    }
    // /complete records the structured projection and marks the job synced in
    // one server-owned transaction, guarded by the job's expected revision.
    await completeProjection(jobId, leaseId, snapshot);
  }

  async function applyMutationPush(jobId: string, leaseId: string, job: ClaimedJob): Promise<void> {
    const payload = job.payload as
      { operation?: unknown; payload?: Record<string, unknown> } | undefined;
    if (!payload || typeof payload !== 'object') {
      await safeRequest('POST', `${jobsUrl(jobId)}/fail`, {
        leaseId,
        errorCode: 'invalid_payload',
      });
      return;
    }

    if (payload.operation === 'daily_summary') {
      const p = payload.payload;
      if (
        typeof p?.date !== 'string' ||
        typeof p.score !== 'number' ||
        typeof p.total !== 'number'
      ) {
        await safeRequest('POST', `${jobsUrl(jobId)}/fail`, {
          leaseId,
          errorCode: 'invalid_payload',
        });
        return;
      }
      const snapshot = await deps.vault.addDailySummary({
        date: p.date,
        score: p.score,
        total: p.total,
        eventId: job.idempotencyKey,
        expectedRevision: typeof job.expectedRevision === 'string' ? job.expectedRevision : null,
      });
      await completeProjection(jobId, leaseId, snapshot);
      return;
    }

    if (payload.operation !== 'journey_mutation') {
      await safeRequest('POST', `${jobsUrl(jobId)}/fail`, {
        leaseId,
        errorCode: 'invalid_payload',
      });
      return;
    }

    const p = payload.payload;
    const expectedRevision = typeof job.expectedRevision === 'string' ? job.expectedRevision : '';
    try {
      let snapshot: JourneySnapshot;
      if (p?.kind === 'task') {
        snapshot = await deps.vault.updateTask({
          date: String(p.date),
          taskId: String(p.taskId),
          completed: Boolean(p.completed),
          evidence: typeof p.evidence === 'string' ? p.evidence : undefined,
          expectedRevision,
          eventId: job.idempotencyKey,
        });
      } else if (p?.kind === 'journal') {
        snapshot = await deps.vault.saveJournal({
          date: String(p.date),
          journal: {
            done: String(p.done),
            blocked: String(p.blocked),
            next: String(p.next),
          },
          expectedRevision,
        });
      } else if (p?.kind === 'evidence') {
        snapshot = await deps.vault.addEvidence({
          date: String(p.date),
          evidence: String(p.evidence),
          expectedRevision,
          eventId: job.idempotencyKey,
        });
      } else {
        await safeRequest('POST', `${jobsUrl(jobId)}/fail`, {
          leaseId,
          errorCode: 'invalid_payload',
        });
        return;
      }
      await completeProjection(jobId, leaseId, snapshot);
    } catch (error) {
      if (error instanceof VaultError && error.code === 'vault_conflict') {
        const current = await readCurrentRevision(String(p?.date));
        if (current) {
          await safeRequest('POST', `${jobsUrl(jobId)}/conflict`, {
            leaseId,
            expectedRevision: expectedRevision || null,
            actualRevision: current,
          });
        } else {
          await safeRequest('POST', `${jobsUrl(jobId)}/fail`, {
            leaseId,
            errorCode: 'vault_read_failed',
          });
        }
        return;
      }
      if (error instanceof VaultError) {
        await safeRequest('POST', `${jobsUrl(jobId)}/fail`, {
          leaseId,
          errorCode: sanitizeErrorCode(error.code),
        });
        return;
      }
      throw error;
    }
  }

  async function readCurrentRevision(date: string): Promise<string | null> {
    try {
      return (await deps.vault.getJourney(date)).revision;
    } catch {
      return null;
    }
  }

  openConnection();

  return {
    async close() {
      stopped = true;
      socket?.close();
      socket = null;
    },
  };
}
