-- Durable, structured Journey/Obsidian synchronization state. The hosted API
-- stores no vault paths and no arbitrary Markdown; only the local bridge sees
-- the configured vault root.

CREATE TABLE IF NOT EXISTS journey_projections (
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vault_id    TEXT NOT NULL CHECK (vault_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
  revision    TEXT NOT NULL CHECK (revision ~ '^[a-f0-9]{64}$'),
  projection  JSONB NOT NULL CHECK (
    jsonb_typeof(projection) = 'object'
    AND projection ? 'daily'
    AND projection - 'daily' = '{}'::jsonb
    AND jsonb_typeof(projection->'daily') = 'object'
    AND projection->'daily' ?& ARRAY['date', 'stage', 'tasks', 'evidence', 'journal']
    AND projection->'daily' - ARRAY['date', 'stage', 'tasks', 'evidence', 'journal'] = '{}'::jsonb
    AND jsonb_typeof(projection->'daily'->'tasks') = 'array'
    AND jsonb_typeof(projection->'daily'->'evidence') = 'array'
    AND jsonb_typeof(projection->'daily'->'journal') = 'object'
    AND projection->'daily'->'journal' ?& ARRAY['done', 'blocked', 'next']
    AND projection->'daily'->'journal' - ARRAY['done', 'blocked', 'next'] = '{}'::jsonb
  ),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, vault_id)
);

CREATE TABLE IF NOT EXISTS journey_sync_jobs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vault_id                   TEXT NOT NULL CHECK (vault_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
  job_type                   TEXT NOT NULL CHECK (job_type IN ('sync', 'mutation')),
  payload                    JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
                               (job_type = 'sync' AND payload = '{}'::jsonb)
                               OR (
                                 job_type = 'mutation'
                                 AND jsonb_typeof(payload) = 'object'
                                 AND payload ?& ARRAY['operation', 'payload']
                                 AND payload - ARRAY['operation', 'payload'] = '{}'::jsonb
                                 AND payload->>'operation' IN ('daily_summary', 'journey_mutation')
                                 AND jsonb_typeof(payload->'payload') = 'object'
                               )
                             ),
  idempotency_key            TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  expected_revision          TEXT CHECK (expected_revision IS NULL OR expected_revision ~ '^[a-f0-9]{64}$'),
  result_revision            TEXT CHECK (result_revision IS NULL OR result_revision ~ '^[a-f0-9]{64}$'),
  state                      TEXT NOT NULL DEFAULT 'pending'
                             CHECK (state IN ('pending', 'claimed', 'synced', 'conflict', 'failed')),
  lease_id                   TEXT CHECK (lease_id IS NULL OR lease_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  lease_expires_at           TIMESTAMPTZ,
  attempt_count              INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  completed_at               TIMESTAMPTZ,
  failure_code               TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  conflict_expected_revision TEXT CHECK (conflict_expected_revision IS NULL OR conflict_expected_revision ~ '^[a-f0-9]{64}$'),
  conflict_actual_revision   TEXT CHECK (conflict_actual_revision IS NULL OR conflict_actual_revision ~ '^[a-f0-9]{64}$'),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, idempotency_key),
  CHECK (
    (state = 'claimed' AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'claimed')
  ),
  CHECK (
    state <> 'conflict'
    OR (conflict_expected_revision IS NOT NULL AND conflict_actual_revision IS NOT NULL)
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
