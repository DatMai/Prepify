import type { SessionQuery } from './sessionRepository';
import { hashOpaqueToken } from './sessionRepository';

export type OAuthProvider = 'google' | 'facebook';

export function createOAuthFlowStore(
  database: SessionQuery,
  provider: OAuthProvider,
  randomState: () => string,
  now: () => Date,
) {
  return {
    async create(codeVerifier: string, returnPath: string): Promise<string> {
      const state = randomState();
      await database.query(
        `INSERT INTO oauth_flows
           (state_hash, provider, code_verifier, return_path, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          hashOpaqueToken(state),
          provider,
          codeVerifier,
          returnPath.startsWith('/') && !returnPath.startsWith('//') ? returnPath : '/',
          new Date(now().getTime() + 10 * 60 * 1000),
        ],
      );
      return state;
    },

    async consume(state: string): Promise<string | null> {
      const result = await database.query<{ code_verifier: string }>(
        `UPDATE oauth_flows
         SET used_at = NOW()
         WHERE state_hash = $1 AND provider = $2
           AND used_at IS NULL AND expires_at > NOW()
         RETURNING code_verifier`,
        [hashOpaqueToken(state), provider],
      );
      return result.rows[0]?.code_verifier ?? null;
    },
  };
}

export type OAuthFlowStore = ReturnType<typeof createOAuthFlowStore>;
