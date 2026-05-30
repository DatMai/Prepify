-- Migration: add streak, leaderboard, quiz session tables
-- Created: 2026-05-29

-- Daily study activity tracking (for streak computation)
CREATE TABLE IF NOT EXISTS study_days (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (user_id, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_study_days_user ON study_days(user_id, activity_date DESC);

-- Quiz session results
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_key     VARCHAR(50) NOT NULL,
  mode          VARCHAR(20) NOT NULL CHECK (mode IN ('flashcard', 'mcq')),
  total         INT NOT NULL,
  score         INT NOT NULL,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user ON quiz_sessions(user_id, completed_at DESC);
