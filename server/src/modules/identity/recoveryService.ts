import { hashOpaqueToken } from './sessionRepository';
import { checkPasswordStrength } from '../../utils/passwordStrength';

export interface RecoveryStore {
  findUserByEmail(email: string): Promise<{ id: string; email: string } | null>;
  replacePasswordReset(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  consumePasswordReset(tokenHash: string, passwordHash: string): Promise<boolean>;
  findUserForVerification(
    userId: string,
  ): Promise<{ id: string; email: string; verified: boolean } | null>;
  replaceEmailVerification(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  consumeEmailVerification(tokenHash: string): Promise<boolean>;
}

interface RecoveryDependencies {
  store: RecoveryStore;
  passwords: { hash(value: string): Promise<string> };
  randomToken: () => string;
  now: () => Date;
  frontendUrl: string;
  callbackBaseUrl: string;
  sendPasswordReset(email: string, url: string): Promise<void>;
  sendVerification(email: string, url: string): Promise<void>;
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

export function createRecoveryService(dependencies: RecoveryDependencies) {
  return {
    async requestPasswordReset(rawEmail: string): Promise<void> {
      const user = await dependencies.store.findUserByEmail(rawEmail.trim().toLowerCase());
      if (!user) return;

      const token = dependencies.randomToken();
      await dependencies.store.replacePasswordReset(
        user.id,
        hashOpaqueToken(token),
        new Date(dependencies.now().getTime() + 30 * 60 * 1000),
      );
      const url = `${dependencies.frontendUrl}/?reset_token=${encodeURIComponent(token)}`;
      void dependencies.sendPasswordReset(user.email, url).catch(() => {});
    },

    async resetPassword(token: string, password: string): Promise<void> {
      if (!checkPasswordStrength(password).valid) throw codedError('weak_password');
      const passwordHash = await dependencies.passwords.hash(password);
      if (!(await dependencies.store.consumePasswordReset(hashOpaqueToken(token), passwordHash))) {
        throw codedError('invalid_reset_token');
      }
    },

    async requestEmailVerification(userId: string): Promise<void> {
      const user = await dependencies.store.findUserForVerification(userId);
      if (!user) throw codedError('auth_required');
      if (user.verified) throw codedError('email_already_verified');

      const token = dependencies.randomToken();
      await dependencies.store.replaceEmailVerification(
        user.id,
        hashOpaqueToken(token),
        new Date(dependencies.now().getTime() + 24 * 60 * 60 * 1000),
      );
      const url = `${dependencies.callbackBaseUrl}/auth/verify-email/${encodeURIComponent(token)}`;
      void dependencies.sendVerification(user.email, url).catch(() => {});
    },

    verifyEmail(token: string): Promise<boolean> {
      return dependencies.store.consumeEmailVerification(hashOpaqueToken(token));
    },
  };
}

export type RecoveryService = ReturnType<typeof createRecoveryService>;
