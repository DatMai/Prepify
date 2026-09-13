-- Durable, structured Journey/Obsidian synchronization state. The hosted API
-- stores no vault paths and no arbitrary Markdown; only the local bridge sees
-- the configured vault root.

CREATE TABLE IF NOT EXISTS journey_projections (
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vault_id    TEXT NOT NULL CHECK (length(vault_id) BETWEEN 1 AND 128),
  revision    TEXT NOT NULL CHECK (revision ~ '^[a-f0-9]{64}$'),
  projection  JSONB NOT NULL CHECK (jsonb_typeof(projection) = 'object'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, vault_id)
);

CREATE TABLE IF NOT EXISTS journey_sync_jobs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vault_id                   TEXT NOT NULL CHECK (length(vault_id) BETWEEN 1 AND 128),
  job_type                   TEXT NOT NULL CHECK (job_type IN ('sync', 'mutation')),
  payload                    JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  idempotency_key            TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  expected_revision          TEXT CHECK (expected_revision IS NULL OR expected_revision ~ '^[a-f0-9]{64}$'),
  result_revision            TEXT CHECK (result_revision IS NULL OR result_revision ~ '^[a-f0-9]{64}$'),
  state                      TEXT NOT NULL DEFAULT 'pending'
                             CHECK (state IN ('pending', 'claimed', 'synced', 'conflict', 'failed')),
  lease_id                   TEXT,
  lease_expires_at           TIMESTAMPTZ,
  attempt_count              INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  completed_at               TIMESTAMPTZ,
  failure_code               TEXT,
  conflict_expected_revision TEXT CHECK (conflict_expected_revision IS NULL OR conflict_expected_revision ~ '^[a-f0-9]{64}$'),
  conflict_actual_revision   TEXT CHECK (conflict_actual_revision IS NULL OR conflict_actual_revision ~ '^[a-f0-9]{64}$'),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, idempotency_key),
  CHECK (
    (state = 'claimed' AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'claimed')
  )
);

CREATE INDEX IF NOT EXISTS journey_sync_jobs_pending_owner_created_idx
  ON journey_sync_jobs (owner_id, created_at ASC)
  WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS journey_audit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id      UUID REFERENCES journey_sync_jobs(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN (
    'requested', 'enqueued', 'claimed', 'completed', 'failed', 'conflicted', 'projection_recorded'
  )),
  details     JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS journey_audit_events_owner_created_idx
  ON journey_audit_events (owner_id, created_at DESC);
