import { describe, expect, it } from 'vitest';
import { createOAuthAccountService, type OAuthAccountStore } from './oauthAccountService';
import type { PublicUser } from './sessionRepository';

const existing: PublicUser = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'User',
  avatarId: 1,
  location: null,
  emailVerifiedAt: '2026-09-01T00:00:00.000Z',
  role: 'user',
};

function store(overrides: Partial<OAuthAccountStore> = {}): OAuthAccountStore {
  return {
    findByProvider: async () => null,
    findByEmail: async () => null,
    createProviderUser: async () => existing,
    ...overrides,
  };
}

describe('OAuth account resolution', () => {
  it('returns the account already linked to the provider identity', async () => {
    const service = createOAuthAccountService(store({ findByProvider: async () => existing }));

    await expect(
      service.resolve({
        provider: 'google',
        providerId: 'google-1',
        email: existing.email,
        emailVerified: true,
        displayName: 'User',
      }),
    ).resolves.toEqual(existing);
  });

  it('refuses to auto-link an existing local account by matching email text', async () => {
    const service = createOAuthAccountService(store({ findByEmail: async () => existing }));

    await expect(
      service.resolve({
        provider: 'google',
        providerId: 'unlinked-google',
        email: existing.email,
        emailVerified: true,
        displayName: 'User',
      }),
    ).rejects.toMatchObject({ code: 'oauth_link_required' });
  });

  it('does not trust an unverified provider email for a new account', async () => {
    let createdEmail = '';
    const service = createOAuthAccountService(
      store({
        createProviderUser: async (input) => {
          createdEmail = input.email;
          return { ...existing, email: input.email };
        },
      }),
    );

    await service.resolve({
      provider: 'facebook',
      providerId: 'facebook-1',
      email: 'claimed@example.com',
      emailVerified: false,
      displayName: 'User',
    });

    expect(createdEmail).toBe('facebook_facebook-1@oauth.prepify.invalid');
  });
});
