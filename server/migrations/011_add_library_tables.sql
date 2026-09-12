-- Library corpus: PostgreSQL becomes the source of truth for topics, sections,
-- questions and the Daily pool. See docs/ADR-004.

CREATE TABLE IF NOT EXISTS library_topics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL,
  locale      TEXT NOT NULL CHECK (locale IN ('vi', 'en')),
  label       TEXT NOT NULL,
  title       TEXT NOT NULL,
  subtitle    TEXT,
  color       TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key, locale)
);

CREATE TABLE IF NOT EXISTS library_sections (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES library_topics(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  name     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS library_questions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES library_sections(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  code       TEXT,
  prompt     TEXT NOT NULL,
  level      TEXT CHECK (level IN ('basic', 'intermediate', 'advanced')),
  blocks     JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS library_daily_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    TEXT NOT NULL,
  locale      TEXT NOT NULL CHECK (locale IN ('vi', 'en')),
  type        TEXT NOT NULL CHECK (type IN ('mcq', 'fib')),
  difficulty  SMALLINT NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  question_id UUID REFERENCES library_questions(id) ON DELETE RESTRICT,
  topic_key   TEXT,
  prompt      TEXT,
  blanks      JSONB,
  hint        TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (entry_id, locale),
  CHECK (
    (type = 'mcq' AND question_id IS NOT NULL)
    OR (type = 'fib' AND prompt IS NOT NULL AND blanks IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS library_topics_locale_position_idx
  ON library_topics (locale, position) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS library_questions_section_position_idx
  ON library_questions (section_id, position);
