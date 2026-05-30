-- Migration: add profile fields (avatar_id, location)
-- Created: 2026-05-30

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_id  SMALLINT NOT NULL DEFAULT 1
                                       CHECK (avatar_id BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS location   VARCHAR(100);
