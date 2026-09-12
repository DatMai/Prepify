import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createSessionRepository, type SessionQuery } from './sessionRepository';

function queryWithRows(rows: unknown[]): SessionQuery {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  };
}

describe('session repository', () => {
  it('persists only a hash of the raw session token', async () => {
    const database = queryWithRows([]);
    const repository = createSessionRepository(database);
    const rawToken = 'raw-session-token-that-must-never-reach-postgres';

    await repository.create('user-1', rawToken, new Date('2026-09-19T00:00:00Z'));

    const values = vi.mocked(database.query).mock.calls[0]?.[1] as unknown[];
    expect(values).not.toContain(rawToken);
    expect(values).toContain(createHash('sha256').update(rawToken).digest('hex'));
  });

  it('returns the current user resolved by an active session', async () => {
    const database = queryWithRows([
      {
        session_id: 'session-1',
        id: 'user-1',
        email: 'admin@example.com',
        display_name: 'Admin',
        avatar_id: 3,
        location: null,
        email_verified_at: new Date('2026-09-01T00:00:00Z'),
        role: 'admin',
      },
    ]);
    const repository = createSessionRepository(database);

    const resolved = await repository.findActive('valid-token');

    expect(resolved).toEqual({
      sessionId: 'session-1',
      user: {
        id: 'user-1',
        email: 'admin@example.com',
        displayName: 'Admin',
        avatarId: 3,
        location: null,
        emailVerifiedAt: '2026-09-01T00:00:00.000Z',
        role: 'admin',
      },
    });
  });

  it('returns null when no active session matches', async () => {
    const repository = createSessionRepository(queryWithRows([]));

    await expect(repository.findActive('expired-token')).resolves.toBeNull();
  });

  it('revokes every active session for a user', async () => {
    const database = queryWithRows([]);
    const repository = createSessionRepository(database);

    await repository.revokeAllForUser('user-1');

    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = $1'), [
      'user-1',
    ]);
  });
});
