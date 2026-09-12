import { createHash } from 'node:crypto';

export type UserRole = 'user' | 'admin';

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarId: number;
  location: string | null;
  emailVerifiedAt: string | null;
  role: UserRole;
}

export interface ResolvedSession {
  sessionId: string;
  user: PublicUser;
}

export interface SessionQuery {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

interface SessionRow {
  session_id: string;
  id: string;
  email: string;
  display_name: string | null;
  avatar_id: number;
  location: string | null;
  email_verified_at: Date | string | null;
  role: UserRole;
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSessionRepository(database: SessionQuery) {
  return {
    async create(userId: string, rawToken: string, expiresAt: Date): Promise<void> {
      await database.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, hashOpaqueToken(rawToken), expiresAt],
      );
    },

    async findActive(rawToken: string): Promise<ResolvedSession | null> {
      const result = await database.query<SessionRow>(
        `SELECT s.id AS session_id,
                u.id, u.email, u.display_name, u.avatar_id, u.location,
                u.email_verified_at, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > NOW()
         LIMIT 1`,
        [hashOpaqueToken(rawToken)],
      );
      const row = result.rows[0];
      if (!row) return null;

      return {
        sessionId: row.session_id,
        user: {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          avatarId: row.avatar_id,
          location: row.location,
          emailVerifiedAt:
            row.email_verified_at instanceof Date
              ? row.email_verified_at.toISOString()
              : row.email_verified_at,
          role: row.role,
        },
      };
    },

    async revoke(rawToken: string): Promise<void> {
      await database.query(
        `UPDATE sessions SET revoked_at = NOW()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashOpaqueToken(rawToken)],
      );
    },

    async revokeAllForUser(userId: string): Promise<void> {
      await database.query(
        `UPDATE sessions SET revoked_at = NOW()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
    },
  };
}

export type SessionRepository = ReturnType<typeof createSessionRepository>;
