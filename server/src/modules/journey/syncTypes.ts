export interface JourneyQuery {
  <Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

export type JourneyTransaction = <T>(fn: (tx: JourneyQuery) => Promise<T>) => Promise<T>;

export type SyncState = 'pending' | 'claimed' | 'synced' | 'conflict' | 'failed';
export type SyncJobType = 'sync' | 'mutation';

export interface SyncStatus {
  jobId: string;
  state: SyncState;
  requestedAt: string;
  completedAt: string | null;
  bridgeConnected: boolean;
}

/** The only note-shaped data permitted in PostgreSQL. It is never raw Markdown. */
export interface DailyTaskProjection {
  id: string;
  checked: boolean;
  text: string;
  tags: string[];
}

export interface DailyJournalProjection {
  done: string;
  blocked: string;
  next: string;
}

export interface DailyListItemProjection {
  text: string;
  checked: boolean | null;
}

/**
 * A faithful, non-Markdown view of one Journey-owned Daily section. Without it
 * the recall callouts and `###` sub-sections of a note never reach the app.
 */
export type DailyBlockProjection =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: DailyListItemProjection[] }
  | { kind: 'quote'; label: string; title: string; lines: string[]; collapsed: boolean };

export interface DailyProjection {
  date: string;
  stage: string;
  tasks: DailyTaskProjection[];
  evidence: string[];
  journal: DailyJournalProjection;
  blocks: DailyBlockProjection[];
}

export interface JourneyProjectionData {
  daily: DailyProjection;
}

export interface JourneyProjection {
  ownerId: string;
  vaultId: string;
  revision: string;
  projection: JourneyProjectionData;
  updatedAt: string;
}

export interface DailySummaryPayload {
  date: string;
  score: number;
  total: number;
}

export type JourneyMutationPayload =
  | { kind: 'task'; date: string; taskId: string; completed: boolean; evidence?: string }
  | { kind: 'journal'; date: string; done: string; blocked: string; next: string }
  | { kind: 'evidence'; date: string; evidence: string };

export type SyncJobPayload =
  | { operation: 'daily_summary'; payload: DailySummaryPayload }
  | { operation: 'journey_mutation'; payload: JourneyMutationPayload }
  | Record<string, never>;

export interface SyncJob {
  jobId: string;
  ownerId: string;
  vaultId: string;
  type: SyncJobType;
  payload: SyncJobPayload;
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

export type EnqueueMutationInput = RequestSyncInput &
  (
    | {
        operation: 'daily_summary';
        payload: DailySummaryPayload;
        expectedRevision?: string | null;
      }
    | {
        operation: 'journey_mutation';
        payload: JourneyMutationPayload;
        expectedRevision: string;
      }
  );

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
  projection: JourneyProjectionData;
}

export type FailSyncJobInput =
  | {
      ownerId: string;
      jobId: string;
      leaseId: string;
      state: 'conflict';
      errorCode: 'revision_conflict';
      expectedRevision: string;
      actualRevision: string;
    }
  | {
      ownerId: string;
      jobId: string;
      leaseId: string;
      state: 'failed';
      errorCode: string;
      expectedRevision?: string | null;
      actualRevision?: string | null;
    };

export interface RecordInboundProjectionInput {
  ownerId: string;
  vaultId: string;
  jobId: string;
  leaseId: string;
  /** Null is valid only for the first projection for a vault. */
  expectedRevision: string | null;
  revision: string;
  projection: JourneyProjectionData;
}
