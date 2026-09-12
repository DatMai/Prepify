import { describe, expect, it } from 'vitest';
import {
  createAuthService,
  type PasswordHasher,
  type UserRepository,
  type UserRecord,
} from './authService';
import type { PublicUser, SessionRepository } from './sessionRepository';

const publicUser: PublicUser = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'User',
  avatarId: 1,
  location: null,
  emailVerifiedAt: null,
  role: 'user',
};

function record(passwordHash: string | null = 'hash:StrongPass1!'): UserRecord {
  return { ...publicUser, passwordHash, disabled: false };
}

function users(initial?: UserRecord): UserRepository {
  let current = initial;
  return {
    findByEmail: async (email) => (current?.email === email ? current : null),
    findById: async (id) => (current?.id === id ? current : null),
    create: async (input) => {
      current = {
        ...publicUser,
        ...input,
        id: 'user-1',
        location: null,
        role: 'user',
        disabled: false,
      };
      return current;
    },
    updateProfile: async (_id, input) => {
      current = { ...current!, ...input };
      return current;
    },
  };
}

function sessions(
  created: Array<{ userId: string; token: string; expiresAt: Date }>,
): SessionRepository {
  return {
    create: async (userId, token, expiresAt) => {
      created.push({ userId, token, expiresAt });
    },
    findActive: async () => null,
    revoke: async () => {},
    revokeAllForUser: async () => {},
  };
}

const passwords: PasswordHasher = {
  hash: async (password) => `hash:${password}`,
  verify: async (password, hash) => hash === `hash:${password}`,
};

describe('auth service', () => {
  it('normalizes an email and creates an opaque session after registration', async () => {
    const issued: Array<{ userId: string; token: string; expiresAt: Date }> = [];
    const service = createAuthService({
      users: users(),
      sessions: sessions(issued),
      passwords,
      randomToken: () => 'opaque-token',
      now: () => new Date('2026-09-12T00:00:00Z'),
      sessionTtlMs: 60_000,
    });

    const result = await service.register({
      email: ' USER@Example.COM ',
      password: 'StrongPass1!',
      displayName: ' User ',
    });

    expect(result.user.email).toBe('user@example.com');
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(issued).toEqual([
      {
        userId: 'user-1',
        token: 'opaque-token',
        expiresAt: new Date('2026-09-12T00:01:00Z'),
      },
    ]);
  });

  it('does not create a session for a wrong password or OAuth-only account', async () => {
    const issued: Array<{ userId: string; token: string; expiresAt: Date }> = [];
    const dependencies = {
      sessions: sessions(issued),
      passwords,
      randomToken: () => 'opaque-token',
      now: () => new Date('2026-09-12T00:00:00Z'),
      sessionTtlMs: 60_000,
    };

    await expect(
      createAuthService({ ...dependencies, users: users(record()) }).login({
        email: publicUser.email,
        password: 'wrong',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(
      createAuthService({ ...dependencies, users: users(record(null)) }).login({
        email: publicUser.email,
        password: 'StrongPass1!',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(issued).toHaveLength(0);
  });

  it('rejects a disabled account with account_disabled', async () => {
    const issued: Array<{ userId: string; token: string; expiresAt: Date }> = [];
    const service = createAuthService({
      users: users({ ...record(), disabled: true }),
      sessions: sessions(issued),
      passwords,
      randomToken: () => 'opaque-token',
      now: () => new Date('2026-09-12T00:00:00Z'),
      sessionTtlMs: 60_000,
    });

    await expect(
      service.login({ email: publicUser.email, password: 'StrongPass1!' }),
    ).rejects.toMatchObject({ code: 'account_disabled' });
    expect(issued).toHaveLength(0);
  });

  it('rejects weak passwords before creating a user', async () => {
    const service = createAuthService({
      users: users(),
      sessions: sessions([]),
      passwords,
      randomToken: () => 'opaque-token',
      now: () => new Date(),
      sessionTtlMs: 60_000,
    });

    await expect(
      service.register({ email: publicUser.email, password: 'weak', displayName: 'User' }),
    ).rejects.toMatchObject({ code: 'weak_password' });
  });
});
