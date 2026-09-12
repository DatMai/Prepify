import type { OAuthAccountStore } from './oauthAccountService';
import type { OAuthProvider } from './oauthFlowStore';
import type { PublicUser, SessionQuery } from './sessionRepository';

interface PublicUserRow {
  id: string;
  email: string;
  display_name: string | null;
  avatar_id: number;
  location: string | null;
  email_verified_at: Date | string | null;
  role: 'user' | 'admin';
}

function mapUser(row: PublicUserRow): PublicUser {
  return {
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
  };
}

export function createOAuthAccountStore(database: SessionQuery): OAuthAccountStore {
  const selectUser = `u.id, u.email, u.display_name, u.avatar_id, u.location,
                      u.email_verified_at, u.role`;
  return {
    async findByProvider(provider: OAuthProvider, providerId: string) {
      const result = await database.query<PublicUserRow>(
        `SELECT ${selectUser}
         FROM oauth_accounts oa JOIN users u ON u.id = oa.user_id
         WHERE oa.provider = $1 AND oa.provider_id = $2 LIMIT 1`,
        [provider, providerId],
      );
      return result.rows[0] ? mapUser(result.rows[0]) : null;
    },

    async findByEmail(email: string) {
      const result = await database.query<PublicUserRow>(
        `SELECT id, email, display_name, avatar_id, location, email_verified_at, role
         FROM users WHERE email = $1 LIMIT 1`,
        [email],
      );
      return result.rows[0] ? mapUser(result.rows[0]) : null;
    },

    async createProviderUser(input) {
      const result = await database.query<PublicUserRow>(
        `WITH created AS (
           INSERT INTO users
             (email, password_hash, display_name, avatar_id, email_verified_at)
           VALUES ($1, NULL, $2, $3, $4)
           RETURNING id, email, display_name, avatar_id, location, email_verified_at, role
         ), linked AS (
           INSERT INTO oauth_accounts (user_id, provider, provider_id)
           SELECT id, $5, $6 FROM created RETURNING user_id
         )
         SELECT created.* FROM created JOIN linked ON linked.user_id = created.id`,
        [
          input.email,
          input.displayName,
          input.avatarId,
          input.email.endsWith('@oauth.prepify.invalid') ? null : new Date(),
          input.provider,
          input.providerId,
        ],
      );
      return mapUser(result.rows[0]);
    },
  };
}
