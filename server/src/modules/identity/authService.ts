import { randomBytes, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { checkPasswordStrength } from '../../utils/passwordStrength';
import type { PublicUser, SessionRepository, UserRole } from './sessionRepository';

export interface UserRecord extends PublicUser {
  passwordHash: string | null;
  disabled: boolean;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(input: {
    email: string;
    passwordHash: string | null;
    displayName: string | null;
    avatarId: number;
    emailVerifiedAt: string | null;
  }): Promise<UserRecord>;
  updateProfile(
    id: string,
    input: { displayName?: string | null; location?: string | null; avatarId?: number },
  ): Promise<UserRecord>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

interface AuthServiceDependencies {
  users: UserRepository;
  sessions: SessionRepository;
  passwords: PasswordHasher;
  randomToken: () => string;
  now: () => Date;
  sessionTtlMs: number;
  randomAvatarId?: () => number;
}

const DUMMY_PASSWORD_HASH = '$2a$10$C6UzMDM.H6dfI/f/IKcEe.kiO5XHGY9un7eYFQ3Q7V1lUQG4QGf6K';

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function publicView(user: UserRecord): PublicUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

export function createDefaultPasswordHasher(): PasswordHasher {
  return {
    hash: (password) => bcrypt.hash(password, 12),
    verify: (password, hash) => bcrypt.compare(password, hash),
  };
}

export function createAuthService(dependencies: AuthServiceDependencies) {
  const issueSession = async (user: UserRecord) => {
    const token = dependencies.randomToken();
    const expiresAt = new Date(dependencies.now().getTime() + dependencies.sessionTtlMs);
    await dependencies.sessions.create(user.id, token, expiresAt);
    return { user: publicView(user), token };
  };

  return {
    async register(input: { email: string; password: string; displayName?: string }) {
      const email = input.email.trim().toLowerCase();
      if (!checkPasswordStrength(input.password).valid) throw codedError('weak_password');
      if (await dependencies.users.findByEmail(email)) throw codedError('email_in_use');

      try {
        const user = await dependencies.users.create({
          email,
          passwordHash: await dependencies.passwords.hash(input.password),
          displayName: input.displayName?.trim() || null,
          avatarId: (dependencies.randomAvatarId ?? (() => randomInt(1, 21)))(),
          emailVerifiedAt: null,
        });
        return issueSession(user);
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw codedError('email_in_use');
        throw error;
      }
    },

    async login(input: { email: string; password: string }) {
      const user = await dependencies.users.findByEmail(input.email.trim().toLowerCase());
      const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
      const matches = await dependencies.passwords.verify(input.password, hash);
      if (!user || !user.passwordHash || !matches) throw codedError('invalid_credentials');
      if (user.disabled) throw codedError('account_disabled');
      return issueSession(user);
    },

    async currentUser(userId: string): Promise<PublicUser> {
      const user = await dependencies.users.findById(userId);
      if (!user) throw codedError('auth_required');
      return publicView(user);
    },

    async logout(rawToken: string): Promise<void> {
      await dependencies.sessions.revoke(rawToken);
    },

    async updateProfile(
      userId: string,
      input: { displayName?: string; location?: string; avatarId?: number },
    ): Promise<PublicUser> {
      const updated = await dependencies.users.updateProfile(userId, {
        ...(input.displayName === undefined ? {} : { displayName: input.displayName || null }),
        ...(input.location === undefined ? {} : { location: input.location || null }),
        ...(input.avatarId === undefined ? {} : { avatarId: input.avatarId }),
      });
      return publicView(updated);
    },
  };
}

export function defaultAuthServiceDependencies() {
  return {
    passwords: createDefaultPasswordHasher(),
    randomToken: () => randomBytes(32).toString('base64url'),
    now: () => new Date(),
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

export type { UserRole };
