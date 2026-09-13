export interface JourneyQuery {
  <Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

export type JourneyTransaction = <T>(fn: (tx: JourneyQuery) => Promise<T>) => Promise<T>;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type SyncState = 'pending' | 'claimed' | 'synced' | 'conflict' | 'failed';
export type SyncJobType = 'sync' | 'mutation';

export interface SyncStatus {
  jobId: string;
  state: SyncState;
  requestedAt: string;
  completedAt: string | null;
  bridgeConnected: boolean;
}

export interface JourneyProjection {
  ownerId: string;
  vaultId: string;
  revision: string;
  projection: JsonObject;
  updatedAt: string;
}

export interface SyncJob {
  jobId: string;
  ownerId: string;
  vaultId: string;
  type: SyncJobType;
  payload: JsonObject;
  idempotencyKey: string;
  expectedRevision: string | null;
  state: SyncState;
  leaseId: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  requestedAt: string;
  completedAt: string | null;
  failureCode: string | null;
  conflictExpectedRevision: string | null;
  conflictActualRevision: string | null;
}

export interface RequestSyncInput {
  ownerId: string;
  vaultId: string;
  idempotencyKey: string;
}

export interface EnqueueMutationInput extends RequestSyncInput {
  operation: 'daily_summary' | 'journey_mutation';
  payload: JsonObject;
  expectedRevision?: string | null;
}

export interface ClaimSyncJobInput {
  ownerId: string;
  jobId: string;
  leaseId: string;
  leaseSeconds: number;
}

export interface CompleteSyncJobInput {
  ownerId: string;
  jobId: string;
  leaseId: string;
  revision: string;
  projection: JsonObject;
}

export interface FailSyncJobInput {
  ownerId: string;
  jobId: string;
  leaseId: string;
  state: 'conflict' | 'failed';
  errorCode: string;
  expectedRevision?: string | null;
  actualRevision?: string | null;
}

export interface RecordInboundProjectionInput {
  ownerId: string;
  vaultId: string;
  revision: string;
  projection: JsonObject;
}
