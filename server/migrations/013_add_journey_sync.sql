-- Durable, structured Journey/Obsidian synchronization state. The hosted API
-- stores no vault paths and no arbitrary Markdown; only the local bridge sees
-- the configured vault root.

CREATE OR REPLACE FUNCTION journey_json_has_exact_keys(value JSONB, allowed TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'object'
     AND value ?& allowed
     AND value - allowed = '{}'::jsonb;
$$;

CREATE OR REPLACE FUNCTION journey_json_has_allowed_keys(value JSONB, required TEXT[], allowed TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'object'
     AND value ?& required
     AND value - allowed = '{}'::jsonb;
$$;

CREATE OR REPLACE FUNCTION journey_json_is_safe_text(value JSONB, maximum_length INTEGER)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'string'
     AND length(value #>> '{}') <= maximum_length
     AND value #>> '{}' !~ E'[\r\n]'
     AND value #>> '{}' !~ E'[`\\[\\]*<>]'
     AND value #>> '{}' !~ E'(^|[[:space:]])[-+][[:space:]]'
     AND value #>> '{}' !~ E'(^|[[:space:]])[0-9]+\\.[[:space:]]'
     AND value #>> '{}' !~ E'(^|[[:space:]])#{1,6}[[:space:]]'
     AND value #>> '{}' !~ E'(^|[[:space:]])/?[[:alnum:]_.-]+(/[[:alnum:]_.-]+)+($|[[:space:]])'
     AND value #>> '{}' !~ E'%[0-9a-fA-F]{2}'
     AND value #>> '{}' !~* E'^[a-z][a-z0-9+.-]*://'
     AND value #>> '{}' !~ E'\\\\';
$$;

CREATE OR REPLACE FUNCTION journey_json_is_tag(value JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'string'
     AND value #>> '{}' ~ E'^#[^#/\\\\*`<>[:space:]]{1,80}$';
$$;

CREATE OR REPLACE FUNCTION journey_json_is_identifier(value JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'string'
     AND value #>> '{}' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$';
$$;

CREATE OR REPLACE FUNCTION journey_json_is_vault_id(value JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'string'
     AND value #>> '{}' ~ '^[a-z][a-z0-9_-]{2,63}$';
$$;

CREATE OR REPLACE FUNCTION journey_json_is_date(value JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'string'
     AND value #>> '{}' ~ '^\d{4}-\d{2}-\d{2}$';
$$;

CREATE OR REPLACE FUNCTION journey_json_is_nonnegative_int(value JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'number'
     AND value #>> '{}' ~ '^(0|[1-9][0-9]{0,8})$';
$$;

CREATE OR REPLACE FUNCTION journey_json_safe_text_array(value JSONB, maximum_items INTEGER, maximum_length INTEGER)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'array'
     AND jsonb_array_length(value) <= maximum_items
     AND NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(value) AS item
       WHERE NOT journey_json_is_safe_text(item, maximum_length)
     );
$$;

CREATE OR REPLACE FUNCTION journey_json_safe_tag_array(value JSONB, maximum_items INTEGER)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'array'
     AND jsonb_array_length(value) <= maximum_items
     AND NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(value) AS item
       WHERE NOT journey_json_is_tag(item)
     );
$$;

CREATE OR REPLACE FUNCTION journey_daily_tasks_are_safe(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  task JSONB;
BEGIN
  IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) > 200 THEN
    RETURN FALSE;
  END IF;
  FOR task IN SELECT jsonb_array_elements(value) LOOP
    IF (
      journey_json_has_exact_keys(task, ARRAY['id', 'checked', 'text', 'tags'])
      AND journey_json_is_identifier(task->'id')
      AND jsonb_typeof(task->'checked') = 'boolean'
      AND journey_json_is_safe_text(task->'text', 1000)
      AND journey_json_safe_tag_array(task->'tags', 32)
    ) IS NOT TRUE THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION journey_projection_is_safe(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  daily JSONB;
  journal JSONB;
BEGIN
  IF NOT journey_json_has_exact_keys(value, ARRAY['daily']) THEN
    RETURN FALSE;
  END IF;
  daily := value->'daily';
  journal := daily->'journal';
  RETURN journey_json_has_exact_keys(daily, ARRAY['date', 'stage', 'tasks', 'evidence', 'journal'])
     AND journey_json_is_date(daily->'date')
     AND journey_json_is_safe_text(daily->'stage', 160)
     AND journey_daily_tasks_are_safe(daily->'tasks')
     AND journey_json_safe_text_array(daily->'evidence', 100, 1000)
     AND journey_json_has_exact_keys(journal, ARRAY['done', 'blocked', 'next'])
     AND journey_json_is_safe_text(journal->'done', 5000)
     AND journey_json_is_safe_text(journal->'blocked', 5000)
     AND journey_json_is_safe_text(journal->'next', 5000);
END;
$$;

CREATE OR REPLACE FUNCTION journey_mutation_payload_is_safe(operation TEXT, value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
BEGIN
  IF operation = 'daily_summary' THEN
    RETURN journey_json_has_exact_keys(value, ARRAY['date', 'score', 'total'])
       AND journey_json_is_date(value->'date')
       AND journey_json_is_nonnegative_int(value->'score')
       AND journey_json_is_nonnegative_int(value->'total')
       AND (value->>'score')::INTEGER <= (value->>'total')::INTEGER
       AND (value->>'total')::INTEGER >= 1;
  END IF;
  IF operation = 'journey_mutation' AND value->>'kind' = 'task' THEN
    RETURN journey_json_has_allowed_keys(
             value,
             ARRAY['kind', 'date', 'taskId', 'completed'],
             ARRAY['kind', 'date', 'taskId', 'completed', 'evidence']
           )
       AND journey_json_is_date(value->'date')
       AND journey_json_is_identifier(value->'taskId')
       AND jsonb_typeof(value->'completed') = 'boolean'
       AND (NOT value ? 'evidence' OR journey_json_is_safe_text(value->'evidence', 1000));
  END IF;
  IF operation = 'journey_mutation' AND value->>'kind' = 'journal' THEN
    RETURN journey_json_has_exact_keys(value, ARRAY['kind', 'date', 'done', 'blocked', 'next'])
       AND journey_json_is_date(value->'date')
       AND journey_json_is_safe_text(value->'done', 5000)
       AND journey_json_is_safe_text(value->'blocked', 5000)
       AND journey_json_is_safe_text(value->'next', 5000);
  END IF;
  IF operation = 'journey_mutation' AND value->>'kind' = 'evidence' THEN
    RETURN journey_json_has_exact_keys(value, ARRAY['kind', 'date', 'evidence'])
       AND journey_json_is_date(value->'date')
       AND journey_json_is_safe_text(value->'evidence', 1000);
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION journey_sync_payload_is_safe(type TEXT, value JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT (type = 'sync' AND value = '{}'::jsonb)
      OR (
        type = 'mutation'
        AND journey_json_has_exact_keys(value, ARRAY['operation', 'payload'])
        AND value->>'operation' IN ('daily_summary', 'journey_mutation')
        AND journey_mutation_payload_is_safe(value->>'operation', value->'payload')
      );
$$;

CREATE OR REPLACE FUNCTION journey_audit_details_are_safe(event TEXT, value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
BEGIN
  IF event IN ('requested', 'enqueued', 'claimed') THEN
    RETURN journey_json_has_exact_keys(value, ARRAY['jobId', 'state'])
       AND journey_json_is_identifier(value->'jobId')
       AND value->>'state' IN ('pending', 'claimed');
  END IF;
  IF event = 'completed' THEN
    RETURN journey_json_has_exact_keys(value, ARRAY['jobId', 'state', 'revision'])
       AND journey_json_is_identifier(value->'jobId')
       AND value->>'state' = 'synced'
       AND value->>'revision' ~ '^[a-f0-9]{64}$';
  END IF;
  IF event = 'failed' THEN
    RETURN journey_json_has_allowed_keys(
             value,
             ARRAY['jobId', 'state', 'errorCode'],
             ARRAY['jobId', 'state', 'errorCode', 'expectedRevision', 'actualRevision']
           )
       AND journey_json_is_identifier(value->'jobId')
       AND value->>'state' = 'failed'
       AND value->>'errorCode' ~ '^[a-z][a-z0-9_]{0,63}$'
       AND (NOT value ? 'expectedRevision' OR value->>'expectedRevision' ~ '^[a-f0-9]{64}$')
       AND (NOT value ? 'actualRevision' OR value->>'actualRevision' ~ '^[a-f0-9]{64}$');
  END IF;
  IF event = 'conflicted' THEN
    RETURN journey_json_has_exact_keys(
             value,
             ARRAY['jobId', 'state', 'errorCode', 'expectedRevision', 'actualRevision']
           )
       AND journey_json_is_identifier(value->'jobId')
       AND value->>'state' = 'conflict'
       AND value->>'errorCode' = 'revision_conflict'
       AND value->>'expectedRevision' ~ '^[a-f0-9]{64}$'
       AND value->>'actualRevision' ~ '^[a-f0-9]{64}$';
  END IF;
  IF event = 'projection_recorded' THEN
    RETURN journey_json_has_exact_keys(value, ARRAY['jobId', 'vaultId', 'revision'])
       AND journey_json_is_identifier(value->'jobId')
       AND journey_json_is_vault_id(value->'vaultId')
       AND value->>'revision' ~ '^[a-f0-9]{64}$';
  END IF;
  RETURN FALSE;
END;
$$;

CREATE TABLE IF NOT EXISTS journey_projections (
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vault_id    TEXT NOT NULL CHECK (vault_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
  revision    TEXT NOT NULL CHECK (revision ~ '^[a-f0-9]{64}$'),
  projection  JSONB NOT NULL CHECK (journey_projection_is_safe(projection) IS TRUE),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, vault_id)
);

CREATE TABLE IF NOT EXISTS journey_sync_jobs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vault_id                   TEXT NOT NULL CHECK (vault_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
  job_type                   TEXT NOT NULL CHECK (job_type IN ('sync', 'mutation')),
  payload                    JSONB NOT NULL DEFAULT '{}'::jsonb
                             CHECK (journey_sync_payload_is_safe(job_type, payload) IS TRUE),
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
  details     JSONB NOT NULL DEFAULT '{}'::jsonb
             CHECK (journey_audit_details_are_safe(event_type, details) IS TRUE),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS journey_audit_events_owner_created_idx
  ON journey_audit_events (owner_id, created_at DESC);
