import { describe, expect, it, vi } from 'vitest';
import type { JourneySyncStatus } from '../api/client';
import {
  SYNC_POLL_DEADLINE_MS,
  SYNC_POLL_INTERVAL_MS,
  canMutate,
  deriveSyncState,
  isTerminalSyncState,
  isRetryable,
  lastSyncedLabel,
  newSyncEventId,
  readLastSyncedAt,
  runSyncJob,
  shouldContinuePolling,
  syncHintLabel,
  syncStatusFromJob,
  writeLastSyncedAt,
} from './syncState';

function job(overrides: Partial<JourneySyncStatus> = {}): JourneySyncStatus {
  return {
    jobId: 'job-1',
    state: 'pending',
    requestedAt: '2026-09-13T00:00:00.000Z',
    completedAt: null,
    bridgeConnected: true,
    ...overrides,
  };
}

describe('sync state machine', () => {
  it('keeps shared sync control helpers available to both surfaces', () => {
    expect(newSyncEventId()).toEqual(expect.any(String));
    expect(isRetryable('bridge_offline')).toBe(true);
    expect(isRetryable('synced')).toBe(false);
    expect(lastSyncedLabel(null, (key) => key)).toBe('sync.lastNever');
    expect(syncHintLabel({ state: 'synced' }, false, (key) => key)).toBe('sync.hint.synced');
  });
  it('maps every server job state onto one of the six UI states', () => {
    expect(deriveSyncState({ jobState: 'synced', bridgeConnected: false })).toBe('synced');
    expect(deriveSyncState({ jobState: 'conflict', bridgeConnected: false })).toBe('conflict');
    expect(deriveSyncState({ jobState: 'failed', bridgeConnected: false })).toBe('failed');
    expect(deriveSyncState({ jobState: 'claimed', bridgeConnected: true })).toBe('syncing');
    expect(deriveSyncState({ jobState: 'pending', bridgeConnected: true })).toBe('pending');
  });

  it('reports bridge_offline for unfinished work when the bridge is disconnected', () => {
    expect(deriveSyncState({ jobState: 'pending', bridgeConnected: false })).toBe('bridge_offline');
    expect(deriveSyncState({ jobState: 'claimed', bridgeConnected: false })).toBe('bridge_offline');
    expect(deriveSyncState({ jobState: null, bridgeConnected: false })).toBe('bridge_offline');
  });

  it('only allows vault-backed mutations while the state is synced', () => {
    expect(canMutate({ state: 'bridge_offline' })).toBe(false);
    expect(canMutate({ state: 'synced' })).toBe(true);
    expect(canMutate({ state: 'pending' })).toBe(false);
    expect(canMutate({ state: 'syncing' })).toBe(false);
    expect(canMutate({ state: 'conflict' })).toBe(false);
    expect(canMutate({ state: 'failed' })).toBe(false);
  });

  it('keeps the previous success time unless a job completes', () => {
    const pending = syncStatusFromJob(job({ state: 'pending' }), '2026-09-12T10:00:00.000Z');
    expect(pending.lastSyncedAt).toBe('2026-09-12T10:00:00.000Z');
    expect(pending.state).toBe('pending');

    const done = syncStatusFromJob(
      job({ state: 'synced', completedAt: '2026-09-13T09:00:00.000Z' }),
      null,
    );
    expect(done.state).toBe('synced');
    expect(done.lastSyncedAt).toBe('2026-09-13T09:00:00.000Z');
  });

  it('stops polling on a terminal state or after the 30-second deadline', () => {
    expect(isTerminalSyncState('synced')).toBe(true);
    expect(isTerminalSyncState('conflict')).toBe(true);
    expect(isTerminalSyncState('failed')).toBe(true);
    expect(isTerminalSyncState('bridge_offline')).toBe(true);
    expect(isTerminalSyncState('pending')).toBe(false);
    expect(isTerminalSyncState('syncing')).toBe(false);

    expect(shouldContinuePolling('pending', 0, 1_000)).toBe(true);
    expect(shouldContinuePolling('pending', 0, SYNC_POLL_DEADLINE_MS)).toBe(false);
    expect(shouldContinuePolling('synced', 0, 0)).toBe(false);
  });

  it('reads and writes the last successful sync time through an injected storage', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };

    expect(readLastSyncedAt(storage)).toBeNull();
    writeLastSyncedAt(storage, '2026-09-13T09:00:00.000Z');
    expect(readLastSyncedAt(storage)).toBe('2026-09-13T09:00:00.000Z');
  });
});

describe('runSyncJob', () => {
  it('requests one user job, polls its status, and stops once synced', async () => {
    const onStatus = vi.fn();
    const requestSync = vi.fn().mockResolvedValue({ jobId: 'job-1' });
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(job({ state: 'pending', bridgeConnected: true }))
      .mockResolvedValueOnce(
        job({ state: 'synced', completedAt: '2026-09-13T09:00:00.000Z', bridgeConnected: true }),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await runSyncJob({
      requestSync,
      fetchStatus,
      onStatus,
      now: () => 0,
      sleep,
      intervalMs: SYNC_POLL_INTERVAL_MS,
    });

    expect(requestSync).toHaveBeenCalledTimes(1);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(result.state).toBe('synced');
    expect(result.lastSyncedAt).toBe('2026-09-13T09:00:00.000Z');
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'synced' }));
  });

  it('stops at the deadline instead of polling forever', async () => {
    let now = 0;
    const fetchStatus = vi.fn().mockImplementation(async () => {
      now = SYNC_POLL_DEADLINE_MS;
      return job({ state: 'pending', bridgeConnected: true });
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await runSyncJob({
      requestSync: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
      fetchStatus,
      onStatus: vi.fn(),
      now: () => now,
      sleep,
    });

    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(result.state).toBe('pending');
  });

  it('reports failure when the status request rejects', async () => {
    const result = await runSyncJob({
      requestSync: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
      fetchStatus: vi.fn().mockRejectedValue(new Error('offline')),
      onStatus: vi.fn(),
      now: () => 0,
      sleep: vi.fn(),
    });

    expect(result.state).toBe('failed');
    expect(result.jobId).toBe('job-1');
  });
});
