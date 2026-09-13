import type { JourneySyncStatus, SyncJobState } from '../api/client';

/**
 * The six states the Journey/Daily sync control shows, per the deployment and
 * on-demand sync design (`docs/superpowers/specs/2026-09-12-deployment-obsidian-on-demand-sync-design.md`).
 * `synced`, `pending`, `syncing`, `conflict`, `failed`, and `bridge_offline`.
 */
export type SyncUiState =
  'synced' | 'pending' | 'syncing' | 'conflict' | 'failed' | 'bridge_offline';

export interface SyncUiStatus {
  state: SyncUiState;
  /** The user-requested job currently being watched, if any. */
  jobId: string | null;
  /** ISO timestamp of the last successful synchronization, if known. */
  lastSyncedAt: string | null;
}

export interface SyncStatusInput {
  jobState: SyncJobState | null;
  bridgeConnected: boolean;
}

/**
 * Polling only ever targets the status of a job the user explicitly requested,
 * and it gives up after this deadline. There is deliberately no recurring
 * background scan of the vault.
 */
export const SYNC_POLL_INTERVAL_MS = 1_000;
export const SYNC_POLL_DEADLINE_MS = 30_000;

export const LAST_SYNCED_STORAGE_KEY = 'prepify:journey:lastSyncedAt';

/** i18n keys for each state, kept as plain strings so this module stays pure. */
export const SYNC_STATE_KEYS: Record<SyncUiState, string> = {
  synced: 'sync.state.synced',
  pending: 'sync.state.pending',
  syncing: 'sync.state.syncing',
  conflict: 'sync.state.conflict',
  failed: 'sync.state.failed',
  bridge_offline: 'sync.state.bridge_offline',
};

export const SYNC_HINT_KEYS: Record<SyncUiState, string> = {
  synced: 'sync.hint.synced',
  pending: 'sync.hint.pending',
  syncing: 'sync.hint.syncing',
  conflict: 'sync.hint.conflict',
  failed: 'sync.hint.failed',
  bridge_offline: 'sync.hint.bridge_offline',
};

/**
 * Projects a server job state plus bridge connectivity onto the six UI states.
 * Bridge connectivity only downgrades *unfinished* work to `bridge_offline`; a
 * durable conflict or failure is reported even while the bridge is away.
 */
export function deriveSyncState({ jobState, bridgeConnected }: SyncStatusInput): SyncUiState {
  if (jobState === 'synced') return 'synced';
  if (jobState === 'conflict') return 'conflict';
  if (jobState === 'failed') return 'failed';
  if (jobState === 'claimed') return bridgeConnected ? 'syncing' : 'bridge_offline';
  return bridgeConnected ? 'pending' : 'bridge_offline';
}

/**
 * Vault-backed mutations (task, journal, evidence) are only safe while the
 * projection is `synced`. Everything else — reading projected content, the
 * database-owned Daily quiz — stays usable.
 */
export function canMutate(status: { state: SyncUiState }): boolean {
  return status.state === 'synced';
}

/// A terminal state needs no more polling: the job resolved, or the bridge is
/// not there to resolve it.
export function isTerminalSyncState(state: SyncUiState): boolean {
  return state !== 'pending' && state !== 'syncing';
}

export function shouldContinuePolling(
  state: SyncUiState,
  startedAt: number,
  now: number,
  deadlineMs: number = SYNC_POLL_DEADLINE_MS,
): boolean {
  if (isTerminalSyncState(state)) return false;
  return now - startedAt < deadlineMs;
}

/** Folds one status response into the UI status, keeping the last success time. */
export function syncStatusFromJob(
  job: JourneySyncStatus,
  lastSyncedAt: string | null,
): SyncUiStatus {
  const state = deriveSyncState({ jobState: job.state, bridgeConnected: job.bridgeConnected });
  return {
    state,
    jobId: job.jobId,
    lastSyncedAt: state === 'synced' ? (job.completedAt ?? lastSyncedAt) : lastSyncedAt,
  };
}

interface LastSyncedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readLastSyncedAt(storage: LastSyncedStorage | undefined): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(LAST_SYNCED_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLastSyncedAt(storage: LastSyncedStorage | undefined, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(LAST_SYNCED_STORAGE_KEY, value);
  } catch {
    // Persisting the timestamp is a convenience; failing it is never fatal.
  }
}

export interface SyncRunnerDeps {
  /** Issues exactly one sync request for the user's explicit action. */
  requestSync: () => Promise<{ jobId: string }>;
  /** Read-only status of that one job. */
  fetchStatus: (jobId: string) => Promise<JourneySyncStatus>;
  onStatus: (status: SyncUiStatus) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  lastSyncedAt?: string | null;
  intervalMs?: number;
  deadlineMs?: number;
}

/**
 * Requests one user-initiated sync job and polls its status until it reaches a
 * terminal state or the 30-second deadline passes. This is not bridge polling:
 * it never repeats for a job the user did not ask for.
 */
export async function runSyncJob(deps: SyncRunnerDeps): Promise<SyncUiStatus> {
  const interval = deps.intervalMs ?? SYNC_POLL_INTERVAL_MS;
  const deadline = deps.deadlineMs ?? SYNC_POLL_DEADLINE_MS;
  const startedAt = deps.now();

  let current: SyncUiStatus = {
    state: 'pending',
    jobId: null,
    lastSyncedAt: deps.lastSyncedAt ?? null,
  };

  try {
    const job = await deps.requestSync();
    current = { ...current, jobId: job.jobId };
    deps.onStatus(current);

    for (;;) {
      const status = await deps.fetchStatus(job.jobId);
      current = syncStatusFromJob(status, current.lastSyncedAt);
      deps.onStatus(current);

      if (!shouldContinuePolling(current.state, startedAt, deps.now(), deadline)) {
        // The durable job survives a timeout; report it as still pending so the
        // user can retry once the bridge comes back.
        if (current.state === 'pending' || current.state === 'syncing') {
          current = { ...current, state: 'pending' };
        }
        return current;
      }

      await deps.sleep(interval);
    }
  } catch {
    current = { ...current, state: 'failed' };
    deps.onStatus(current);
    return current;
  }
}
