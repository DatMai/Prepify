-- The Daily projection now carries a faithful, non-Markdown view of every
-- Journey-owned section, so the app can show the recall callouts and `###`
-- sub-sections that the structured task/journal fields alone would drop.
--
-- Block text is display-only: it is never written back into the vault. It
-- therefore uses its own single-line validator instead of
-- `journey_json_is_safe_text`, which is deliberately strict because mutation
-- payloads are spliced into the note.

CREATE OR REPLACE FUNCTION journey_block_text_is_safe(value JSONB, maximum_length INTEGER)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'string'
     AND length(value #>> '{}') <= maximum_length
     AND value #>> '{}' !~ E'[\r\n]';
$$;

-- `tasks[].text` is display-only: the app never sends a task text back, only the
-- task id and the completed flag. Validating it with `journey_json_is_safe_text`
-- rejected ordinary notes — the path-like rule flagged dates such as `08/09` and
-- labels such as `Array/Hash` — so every real note failed to upload. Evidence and
-- the journal fields stay strict because those values are spliced into the note.
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
      AND journey_block_text_is_safe(task->'text', 2000)
      AND journey_json_safe_tag_array(task->'tags', 32)
    ) IS NOT TRUE THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION journey_daily_blocks_are_safe(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  block JSONB;
  item JSONB;
  line JSONB;
BEGIN
  IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) > 500 THEN
    RETURN FALSE;
  END IF;

  FOR block IN SELECT jsonb_array_elements(value) LOOP
    IF block->>'kind' = 'heading' THEN
      IF (
        journey_json_has_exact_keys(block, ARRAY['kind', 'level', 'text'])
        AND block->>'level' ~ '^[1-6]$'
        AND journey_block_text_is_safe(block->'text', 500)
      ) IS NOT TRUE THEN
        RETURN FALSE;
      END IF;

    ELSIF block->>'kind' = 'paragraph' THEN
      IF (
        journey_json_has_exact_keys(block, ARRAY['kind', 'text'])
        AND journey_block_text_is_safe(block->'text', 5000)
      ) IS NOT TRUE THEN
        RETURN FALSE;
      END IF;

    ELSIF block->>'kind' = 'list' THEN
      IF (
        journey_json_has_exact_keys(block, ARRAY['kind', 'ordered', 'items'])
        AND jsonb_typeof(block->'ordered') = 'boolean'
        AND jsonb_typeof(block->'items') = 'array'
        AND jsonb_array_length(block->'items') <= 200
      ) IS NOT TRUE THEN
        RETURN FALSE;
      END IF;

      FOR item IN SELECT jsonb_array_elements(block->'items') LOOP
        IF (
          journey_json_has_exact_keys(item, ARRAY['text', 'checked'])
          AND journey_block_text_is_safe(item->'text', 2000)
          AND (
            jsonb_typeof(item->'checked') = 'boolean'
            OR item->'checked' = 'null'::jsonb
          )
        ) IS NOT TRUE THEN
          RETURN FALSE;
        END IF;
      END LOOP;

    ELSIF block->>'kind' = 'quote' THEN
      IF (
        journey_json_has_exact_keys(block, ARRAY['kind', 'label', 'title', 'lines', 'collapsed'])
        AND (block->>'label' = '' OR block->>'label' ~ '^[a-z][a-z0-9-]{0,31}$')
        AND journey_block_text_is_safe(block->'title', 500)
        AND jsonb_typeof(block->'collapsed') = 'boolean'
        AND jsonb_typeof(block->'lines') = 'array'
        AND jsonb_array_length(block->'lines') <= 200
      ) IS NOT TRUE THEN
        RETURN FALSE;
      END IF;

      FOR line IN SELECT jsonb_array_elements(block->'lines') LOOP
        IF journey_block_text_is_safe(line, 5000) IS NOT TRUE THEN
          RETURN FALSE;
        END IF;
      END LOOP;

    ELSE
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
  RETURN journey_json_has_exact_keys(
           daily,
           ARRAY['date', 'stage', 'tasks', 'evidence', 'journal', 'blocks']
         )
     AND journey_json_is_date(daily->'date')
     AND journey_json_is_safe_text(daily->'stage', 160)
     AND journey_daily_tasks_are_safe(daily->'tasks')
     AND journey_json_safe_text_array(daily->'evidence', 100, 1000)
     AND journey_json_has_exact_keys(journal, ARRAY['done', 'blocked', 'next'])
     AND journey_json_is_safe_text(journal->'done', 5000)
     AND journey_json_is_safe_text(journal->'blocked', 5000)
     AND journey_json_is_safe_text(journal->'next', 5000)
     AND journey_daily_blocks_are_safe(daily->'blocks');
END;
$$;

-- Projections recorded before this migration carry no blocks. Give them an
-- empty list so the stricter validator above keeps accepting the row.
UPDATE journey_projections
   SET projection = jsonb_set(projection, '{daily,blocks}', '[]'::jsonb)
 WHERE NOT (projection->'daily' ? 'blocks');
