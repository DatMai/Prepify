import type { SessionQuery } from './sessionRepository';
import type { RecoveryStore } from './recoveryService';

export function createRecoveryStore(database: SessionQuery): RecoveryStore {
  return {
    async findUserByEmail(email) {
      const result = await database.query<{ id: string; email: string }>(
        'SELECT id, email FROM users WHERE email = $1 LIMIT 1',
        [email],
      );
      return result.rows[0] ?? null;
    },

    async replacePasswordReset(userId, tokenHash, expiresAt) {
      await database.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
      await database.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, tokenHash, expiresAt],
      );
    },

    async consumePasswordReset(tokenHash, passwordHash) {
      const result = await database.query<{ id: string }>(
        `WITH claimed AS (
           UPDATE password_reset_tokens
           SET used_at = NOW()
           WHERE id = (
             SELECT id FROM password_reset_tokens
             WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
             LIMIT 1 FOR UPDATE SKIP LOCKED
           )
           RETURNING user_id
         ), changed AS (
           UPDATE users SET password_hash = $2
           FROM claimed WHERE users.id = claimed.user_id
           RETURNING users.id
         ), revoked AS (
           UPDATE sessions SET revoked_at = NOW()
           FROM changed
           WHERE sessions.user_id = changed.id AND sessions.revoked_at IS NULL
         )
         SELECT id FROM changed`,
        [tokenHash, passwordHash],
      );
      return result.rows.length === 1;
    },

    async findUserForVerification(userId) {
      const result = await database.query<{
        id: string;
        email: string;
        email_verified_at: Date | null;
      }>('SELECT id, email, email_verified_at FROM users WHERE id = $1 LIMIT 1', [userId]);
      const row = result.rows[0];
      return row
        ? { id: row.id, email: row.email, verified: Boolean(row.email_verified_at) }
        : null;
    },

    async replaceEmailVerification(userId, tokenHash, expiresAt) {
      await database.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
      await database.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, tokenHash, expiresAt],
      );
    },

    async consumeEmailVerification(tokenHash) {
      const result = await database.query<{ id: string }>(
        `WITH claimed AS (
           DELETE FROM email_verification_tokens
           WHERE id = (
             SELECT id FROM email_verification_tokens
             WHERE token_hash = $1 AND expires_at > NOW()
             LIMIT 1 FOR UPDATE SKIP LOCKED
           )
           RETURNING user_id
         )
         UPDATE users SET email_verified_at = NOW()
         FROM claimed WHERE users.id = claimed.user_id
         RETURNING users.id`,
        [tokenHash],
      );
      return result.rows.length === 1;
    },
  };
}
