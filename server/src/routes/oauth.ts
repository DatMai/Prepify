import { Router } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { db } from '../db/client';
import jwt from 'jsonwebtoken';

interface OAuthUser {
  userId: string;
  email: string;
}

async function findOrCreateOAuthUser(
  provider: 'google' | 'facebook',
  providerId: string,
  email: string | null,
  displayName: string | null,
): Promise<OAuthUser> {
  const existing = await db.query<{ user_id: string }>(
    'SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_id = $2',
    [provider, providerId],
  );
  if (existing.rows[0]) {
    const user = await db.query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE id = $1',
      [existing.rows[0].user_id],
    );
    return { userId: user.rows[0].id, email: user.rows[0].email };
  }

  if (email) {
    const byEmail = await db.query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE email = $1',
      [email.toLowerCase()],
    );
    if (byEmail.rows[0]) {
      await db.query(
        'INSERT INTO oauth_accounts (user_id, provider, provider_id) VALUES ($1, $2, $3)',
        [byEmail.rows[0].id, provider, providerId],
      );
      return { userId: byEmail.rows[0].id, email: byEmail.rows[0].email };
    }
  }

  const fallbackEmail = email ?? `${provider}_${providerId}@oauth.prepify`;
  const newUser = await db.query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, display_name, email_verified_at)
     VALUES ($1, NULL, $2, NOW())
     RETURNING id, email`,
    [fallbackEmail, displayName],
  );
  await db.query(
    'INSERT INTO oauth_accounts (user_id, provider, provider_id) VALUES ($1, $2, $3)',
    [newUser.rows[0].id, provider, providerId],
  );
  return { userId: newUser.rows[0].id, email: newUser.rows[0].email };
}

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const CALLBACK_BASE = process.env.OAUTH_CALLBACK_BASE ?? 'http://localhost:3001';

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${CALLBACK_BASE}/auth/google/callback`,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value ?? null;
          const user = await findOrCreateOAuthUser('google', profile.id, email, profile.displayName);
          done(null, user);
        } catch (e) {
          done(e as Error);
        }
      },
    ),
  );
}

if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: `${CALLBACK_BASE}/auth/facebook/callback`,
        profileFields: ['id', 'emails', 'name', 'displayName'],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value ?? null;
          const name =
            profile.displayName ||
            [profile.name?.givenName, profile.name?.familyName].filter(Boolean).join(' ') ||
            null;
          const user = await findOrCreateOAuthUser('facebook', profile.id, email, name);
          done(null, user);
        } catch (e) {
          done(e as Error);
        }
      },
    ),
  );
}

function makeToken(user: OAuthUser): string {
  return jwt.sign({ userId: user.userId, email: user.email }, process.env.JWT_SECRET!, { expiresIn: '7d' });
}

const router = Router();

const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const facebookConfigured = !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);

if (googleConfigured) {
  router.get('/google', passport.authenticate('google', { session: false, scope: ['profile', 'email'] }));
  router.get(
    '/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: `${FRONTEND_URL}/?oauth_error=1` }),
    (req, res) => {
      const user = req.user as unknown as OAuthUser;
      res.redirect(`${FRONTEND_URL}/?auth_token=${makeToken(user)}`);
    },
  );
} else {
  router.get('/google', (_req, res) => res.redirect(`${FRONTEND_URL}/?oauth_error=not_configured`));
  router.get('/google/callback', (_req, res) => res.redirect(`${FRONTEND_URL}/?oauth_error=not_configured`));
}

if (facebookConfigured) {
  router.get('/facebook', passport.authenticate('facebook', { session: false, scope: ['email'] }));
  router.get(
    '/facebook/callback',
    passport.authenticate('facebook', { session: false, failureRedirect: `${FRONTEND_URL}/?oauth_error=1` }),
    (req, res) => {
      const user = req.user as unknown as OAuthUser;
      res.redirect(`${FRONTEND_URL}/?auth_token=${makeToken(user)}`);
    },
  );
} else {
  router.get('/facebook', (_req, res) => res.redirect(`${FRONTEND_URL}/?oauth_error=not_configured`));
  router.get('/facebook/callback', (_req, res) => res.redirect(`${FRONTEND_URL}/?oauth_error=not_configured`));
}

export default router;
