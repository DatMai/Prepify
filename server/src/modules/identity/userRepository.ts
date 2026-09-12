import type { SessionQuery } from './sessionRepository';
import type { UserRecord, UserRepository } from './authService';

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string | null;
  avatar_id: number;
  location: string | null;
  email_verified_at: Date | string | null;
  role: 'user' | 'admin';
  disabled: boolean;
}

const SELECT_USER = `
  SELECT id, email, password_hash, display_name, avatar_id, location, email_verified_at, role, disabled
  FROM users`;

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    avatarId: row.avatar_id,
    location: row.location,
    emailVerifiedAt:
      row.email_verified_at instanceof Date
        ? row.email_verified_at.toISOString()
        : row.email_verified_at,
    role: row.role,
    disabled: row.disabled,
  };
}

export function createUserRepository(database: SessionQuery): UserRepository {
  return {
    async findByEmail(email) {
      const result = await database.query<UserRow>(`${SELECT_USER} WHERE email = $1 LIMIT 1`, [
        email,
      ]);
      return result.rows[0] ? mapUser(result.rows[0]) : null;
    },

    async findById(id) {
      const result = await database.query<UserRow>(`${SELECT_USER} WHERE id = $1 LIMIT 1`, [id]);
      return result.rows[0] ? mapUser(result.rows[0]) : null;
    },

    async create(input) {
      const result = await database.query<UserRow>(
        `INSERT INTO users (email, password_hash, display_name, avatar_id, email_verified_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, password_hash, display_name, avatar_id, location,
                   email_verified_at, role, disabled`,
        [input.email, input.passwordHash, input.displayName, input.avatarId, input.emailVerifiedAt],
      );
      return mapUser(result.rows[0]);
    },

    async updateProfile(id, input) {
      const result = await database.query<UserRow>(
        `UPDATE users
         SET display_name = COALESCE($1, display_name),
             location = COALESCE($2, location),
             avatar_id = COALESCE($3, avatar_id)
         WHERE id = $4
         RETURNING id, email, password_hash, display_name, avatar_id, location,
                   email_verified_at, role, disabled`,
        [input.displayName ?? null, input.location ?? null, input.avatarId ?? null, id],
      );
      if (!result.rows[0])
        throw Object.assign(new Error('User not found'), { code: 'auth_required' });
      return mapUser(result.rows[0]);
    },
  };
}
