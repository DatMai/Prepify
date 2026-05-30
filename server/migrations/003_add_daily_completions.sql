-- Migration: add daily challenge completions table
-- Created: 2026-05-30

CREATE TABLE IF NOT EXISTS daily_completions (
  user_id        UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_date DATE  NOT NULL,
  score          INT   NOT NULL,
  total          INT   NOT NULL,
  completed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, challenge_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_comp_user ON daily_completions(user_id, challenge_date DESC);
