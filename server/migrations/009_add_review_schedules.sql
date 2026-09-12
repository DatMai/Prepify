-- Lịch ôn tập theo SM-2 cho từng câu hỏi của mỗi user.

CREATE TABLE IF NOT EXISTS review_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic         TEXT NOT NULL,
  section_idx   INTEGER NOT NULL,
  question_idx  INTEGER NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 1,
  ease          DOUBLE PRECISION NOT NULL DEFAULT 2.5,
  due_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_count  INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, topic, section_idx, question_idx)
);

CREATE INDEX IF NOT EXISTS idx_review_due ON review_schedules (user_id, due_at);
