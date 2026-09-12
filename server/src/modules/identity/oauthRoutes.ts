import { randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import passport from 'passport';
import {
  Strategy as FacebookStrategy,
  type StrategyOptions as FacebookOptions,
} from 'passport-facebook';
import {
  Strategy as GoogleStrategy,
  type StrategyOptions as GoogleOptions,
} from 'passport-google-oauth20';
import type { StateStore } from 'passport-oauth2';
import type { AppConfig } from '../../config/env';
import type { PublicUser, SessionRepository } from './sessionRepository';
import type { OAuthFlowStore, OAuthProvider } from './oauthFlowStore';
import { setSessionCookie } from './sessionCookie';
import type { OAuthProfileInput } from './oauthAccountService';

interface OAuthDependencies {
  config: AppConfig;
  accountService: { resolve(profile: OAuthProfileInput): Promise<PublicUser> };
  sessions: SessionRepository;
  flows: Record<OAuthProvider, OAuthFlowStore>;
  randomToken?: () => string;
  now?: () => Date;
}

interface PassportOAuthUser {
  userId: string;
  email: string;
  role: 'user' | 'admin';
}

interface StateCallback {
  (error: Error | null, state?: string): void;
}

interface VerifyCallback {
  (error: Error | null, ok: string | false, state?: { message: string }): void;
}

function passportStateStore(flow: OAuthFlowStore) {
  return {
    store(
      _req: unknown,
      verifier: string,
      _state: unknown,
      _meta: unknown,
      callback: StateCallback,
    ): void {
      void flow.create(verifier, '/').then((state) => callback(null, state), callback);
    },
    verify(_req: unknown, state: string, callback: VerifyCallback): void {
      void flow
        .consume(state)
        .then((verifier) =>
          verifier
            ? callback(null, verifier)
            : callback(null, false, { message: 'Invalid or expired OAuth state' }),
        )
        .catch((error: Error) => callback(error, false));
    },
  };
}

function oauthFailure(frontendUrl: string, code = '1'): string {
  return `${frontendUrl}/?oauth_error=${encodeURIComponent(code)}`;
}

export function createOAuthRoutes(dependencies: OAuthDependencies): Router {
  const { config } = dependencies;
  const router = Router();
  const randomToken = dependencies.randomToken ?? (() => randomBytes(32).toString('base64url'));
  const now = dependencies.now ?? (() => new Date());
  const sessionTtlMs = config.session.ttlHours * 60 * 60 * 1000;

  const configureGoogle = (): boolean => {
    if (!config.oauth.google) return false;
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.oauth.google.clientId,
          clientSecret: config.oauth.google.clientSecret,
          callbackURL: `${config.publicApiUrl}/api/v1/auth/google/callback`,
          state: true,
          pkce: true,
          store: passportStateStore(dependencies.flows.google) as unknown as StateStore,
        } satisfies GoogleOptions,
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const raw = profile._json as { email_verified?: boolean };
            const user = await dependencies.accountService.resolve({
              provider: 'google',
              providerId: profile.id,
              email: profile.emails?.[0]?.value ?? null,
              emailVerified: raw.email_verified === true,
              displayName: profile.displayName,
            });
            done(null, { userId: user.id, email: user.email, role: user.role });
          } catch (error) {
            done(error as Error);
          }
        },
      ),
    );
    return true;
  };

  const configureFacebook = (): boolean => {
    if (!config.oauth.facebook) return false;
    passport.use(
      new FacebookStrategy(
        {
          clientID: config.oauth.facebook.clientId,
          clientSecret: config.oauth.facebook.clientSecret,
          callbackURL: `${config.publicApiUrl}/api/v1/auth/facebook/callback`,
          profileFields: ['id', 'emails', 'name', 'displayName'],
          state: true,
          pkce: true,
          store: passportStateStore(dependencies.flows.facebook) as unknown as StateStore,
        } satisfies FacebookOptions,
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const user = await dependencies.accountService.resolve({
              provider: 'facebook',
              providerId: profile.id,
              email: profile.emails?.[0]?.value ?? null,
              emailVerified: false,
              displayName: profile.displayName || null,
            });
            done(null, { userId: user.id, email: user.email, role: user.role });
          } catch (error) {
            done(error as Error);
          }
        },
      ),
    );
    return true;
  };

  const callback =
    (provider: OAuthProvider) => (req: Request, res: Response, next: NextFunction) => {
      passport.authenticate(
        provider,
        { session: false },
        async (error: unknown, user?: PassportOAuthUser) => {
          if (error || !user) {
            const code = (error as { code?: string } | undefined)?.code;
            res.redirect(
              oauthFailure(config.frontendUrl, code === 'oauth_link_required' ? code : '1'),
            );
            return;
          }
          try {
            const token = randomToken();
            await dependencies.sessions.create(
              user.userId,
              token,
              new Date(now().getTime() + sessionTtlMs),
            );
            setSessionCookie(
              res,
              config.session.cookieName,
              token,
              config.session.secure,
              sessionTtlMs,
            );
            res.redirect(`${config.frontendUrl}/?oauth_success=1`);
          } catch (sessionError) {
            next(sessionError);
          }
        },
      )(req, res, next);
    };

  const googleConfigured = configureGoogle();
  const facebookConfigured = configureFacebook();

  router.get(
    '/google',
    googleConfigured
      ? passport.authenticate('google', { session: false, scope: ['profile', 'email'] })
      : (_req, res) => res.redirect(oauthFailure(config.frontendUrl, 'not_configured')),
  );
  router.get(
    '/google/callback',
    googleConfigured
      ? callback('google')
      : (_req, res) => res.redirect(oauthFailure(config.frontendUrl, 'not_configured')),
  );
  router.get(
    '/facebook',
    facebookConfigured
      ? passport.authenticate('facebook', { session: false, scope: ['email'] })
      : (_req, res) => res.redirect(oauthFailure(config.frontendUrl, 'not_configured')),
  );
  router.get(
    '/facebook/callback',
    facebookConfigured
      ? callback('facebook')
      : (_req, res) => res.redirect(oauthFailure(config.frontendUrl, 'not_configured')),
  );

  return router;
}
