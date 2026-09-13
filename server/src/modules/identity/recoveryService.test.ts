import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createRecoveryService, type RecoveryStore } from './recoveryService';

function store(overrides: Partial<RecoveryStore> = {}): RecoveryStore {
  return {
    findUserByEmail: async () => null,
    replacePasswordReset: async () => {},
    consumePasswordReset: async () => false,
    findUserForVerification: async () => null,
    replaceEmailVerification: async () => {},
    consumeEmailVerification: async () => false,
    ...overrides,
  };
}

describe('recovery service', () => {
  it('stores only a reset-token hash while emailing the raw one', async () => {
    let storedHash = '';
    let deliveredUrl = '';
    const service = createRecoveryService({
      store: store({
        findUserByEmail: async () => ({ id: 'user-1', email: 'user@example.com' }),
        replacePasswordReset: async (_userId, hash) => {
          storedHash = hash;
        },
      }),
      passwords: { hash: async (value) => `hash:${value}` },
      randomToken: () => 'raw-reset-token',
      now: () => new Date('2026-09-12T00:00:00Z'),
      frontendUrl: 'https://prepify.example',
      callbackBaseUrl: 'https://prepify.example/api/v1',
      sendPasswordReset: async (_email, url) => {
        deliveredUrl = url;
      },
      sendVerification: async () => {},
    });

    await service.requestPasswordReset(' USER@example.com ');
    await Promise.resolve();

    expect(storedHash).toBe(createHash('sha256').update('raw-reset-token').digest('hex'));
    expect(storedHash).not.toContain('raw-reset-token');
    expect(deliveredUrl).toBe('https://prepify.example/?reset_token=raw-reset-token');
  });

  it('rejects a replayed or expired reset token with one public code', async () => {
    const service = createRecoveryService({
      store: store({ consumePasswordReset: async () => false }),
      passwords: { hash: async (value) => `hash:${value}` },
      randomToken: () => 'token',
      now: () => new Date(),
      frontendUrl: 'https://prepify.example',
      callbackBaseUrl: 'https://prepify.example/api/v1',
      sendPasswordReset: async () => {},
      sendVerification: async () => {},
    });

    await expect(service.resetPassword('invalid', 'StrongPass1!')).rejects.toMatchObject({
      code: 'invalid_reset_token',
    });
  });

  it('logs and surfaces a verification delivery failure', async () => {
    const onEmailError = vi.fn();
    const smtpError = new Error('bad credentials');
    const service = createRecoveryService({
      store: store({
        findUserForVerification: async () => ({
          id: 'user-1',
          email: 'user@example.com',
          verified: false,
        }),
      }),
      passwords: { hash: async (value) => `hash:${value}` },
      randomToken: () => 'verification-token',
      now: () => new Date(),
      frontendUrl: 'https://prepify.example',
      callbackBaseUrl: 'https://prepify.example/api/v1',
      sendPasswordReset: async () => {},
      sendVerification: async () => {
        throw smtpError;
      },
      onEmailError,
    });

    await expect(service.requestEmailVerification('user-1')).rejects.toMatchObject({
      code: 'email_delivery_failed',
    });
    expect(onEmailError).toHaveBeenCalledWith(smtpError, 'verification');
  });
});
