interface AdminQuery {
  <Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface AdminStats {
  totalUsers: number;
  totalAdmins: number;
  activeSessions: number;
  dailyCompletionsToday: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string | null;
  role: 'user' | 'admin';
  disabled: boolean;
  emailVerifiedAt: string | null;
  lastSeenAt: string | null;
  providers: string[];
}

interface UserRecord extends Record<string, unknown> {
  id: string;
  email: string;
  display_name: string | null;
  role: 'user' | 'admin';
  disabled: boolean;
  email_verified_at: string | null;
  last_seen_at?: string | null;
  providers?: string | null;
}

function mapUser(row: UserRecord): AdminUserRow {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    disabled: row.disabled,
    emailVerifiedAt: row.email_verified_at,
    lastSeenAt: row.last_seen_at ?? null,
    providers: row.providers ? row.providers.split(',').filter(Boolean) : [],
  };
}

const USER_SELECT = `
  u.id,
  u.email,
  u.display_name,
  u.role,
  u.disabled,
  u.email_verified_at,
  (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id)::text AS last_seen_at,
  (SELECT COALESCE(string_agg(o.provider, ',' ORDER BY o.provider), '')
     FROM oauth_accounts o WHERE o.user_id = u.id)::text AS providers`;

const USER_FILTER = `($1 = '' OR lower(u.email) LIKE '%' || lower($1) || '%' OR lower(COALESCE(u.display_name, '')) LIKE '%' || lower($1) || '%')`;

export function createAdminRepository(deps: { query: AdminQuery }) {
  return {
    async stats(): Promise<AdminStats> {
      const { rows } = await deps.query<{
        total_users: string;
        total_admins: string;
        active_sessions: string;
        daily_completions: string;
      }>(
        `SELECT
          (SELECT COUNT(*) FROM users)::text AS total_users,
          (SELECT COUNT(*) FROM users WHERE role = 'admin')::text AS total_admins,
          (SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL)::text AS active_sessions,
          (SELECT COUNT(*) FROM daily_completions WHERE challenge_date = CURRENT_DATE)::text AS daily_completions`,
        [],
      );
      const row = rows[0];
      return {
        totalUsers: Number(row?.total_users ?? 0),
        totalAdmins: Number(row?.total_admins ?? 0),
        activeSessions: Number(row?.active_sessions ?? 0),
        dailyCompletionsToday: Number(row?.daily_completions ?? 0),
      };
    },

    async listUsers(input: {
      search: string;
      limit: number;
      offset: number;
    }): Promise<{ total: number; items: AdminUserRow[] }> {
      const count = await deps.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM users u WHERE ${USER_FILTER}`,
        [input.search],
      );
      const page = await deps.query<UserRecord>(
        `SELECT ${USER_SELECT} FROM users u
         WHERE ${USER_FILTER}
         ORDER BY u.created_at DESC
         LIMIT $2 OFFSET $3`,
        [input.search, input.limit, input.offset],
      );
      return { total: Number(count.rows[0]?.total ?? 0), items: page.rows.map(mapUser) };
    },

    async findById(userId: string): Promise<AdminUserRow | null> {
      const { rows } = await deps.query<UserRecord>(
        `SELECT ${USER_SELECT} FROM users u WHERE u.id = $1`,
        [userId],
      );
      return rows.length > 0 ? mapUser(rows[0]) : null;
    },

    async setRole(userId: string, role: 'user' | 'admin'): Promise<void> {
      await deps.query(`UPDATE users SET role = $2 WHERE id = $1`, [userId, role]);
    },

    async setDisabled(userId: string, disabled: boolean): Promise<void> {
      await deps.query(`UPDATE users SET disabled = $2 WHERE id = $1`, [userId, disabled]);
      if (disabled) {
        await deps.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
      }
    },
  };
}

export type AdminRepository = ReturnType<typeof createAdminRepository>;
