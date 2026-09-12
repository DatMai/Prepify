import { createHash, randomInt } from 'node:crypto';
import type { PublicUser } from './sessionRepository';
import type { OAuthProvider } from './oauthFlowStore';

export interface OAuthProfileInput {
  provider: OAuthProvider;
  providerId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

export interface OAuthAccountStore {
  findByProvider(provider: OAuthProvider, providerId: string): Promise<PublicUser | null>;
  findByEmail(email: string): Promise<PublicUser | null>;
  createProviderUser(input: {
    provider: OAuthProvider;
    providerId: string;
    email: string;
    displayName: string | null;
    avatarId: number;
  }): Promise<PublicUser>;
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function fallbackEmail(provider: OAuthProvider, providerId: string): string {
  const safeId = /^[A-Za-z0-9._-]{1,80}$/.test(providerId)
    ? providerId
    : createHash('sha256').update(providerId).digest('hex').slice(0, 32);
  return `${provider}_${safeId}@oauth.prepify.invalid`;
}

export function createOAuthAccountService(
  store: OAuthAccountStore,
  avatarId: () => number = () => randomInt(1, 21),
) {
  return {
    async resolve(profile: OAuthProfileInput): Promise<PublicUser> {
      const linked = await store.findByProvider(profile.provider, profile.providerId);
      if (linked) return linked;

      const trustedEmail = profile.emailVerified ? profile.email?.trim().toLowerCase() : null;
      if (trustedEmail && (await store.findByEmail(trustedEmail))) {
        throw codedError('oauth_link_required');
      }

      return store.createProviderUser({
        provider: profile.provider,
        providerId: profile.providerId,
        email: trustedEmail ?? fallbackEmail(profile.provider, profile.providerId),
        displayName: profile.displayName,
        avatarId: avatarId(),
      });
    },
  };
}
