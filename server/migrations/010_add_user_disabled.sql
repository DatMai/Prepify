-- Cờ khóa tài khoản dùng cho admin panel.

ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
