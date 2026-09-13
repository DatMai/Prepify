import { z } from 'zod';

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    DATABASE_URL: z.string().trim().min(1),
    SESSION_SECRET: z.string().min(32),
    CONTENT_ROOT: z.string().trim().min(1).optional(),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),
    PUBLIC_API_URL: z.string().url().default('http://localhost:3001'),
    APP_TIME_ZONE: z
      .string()
      .trim()
      .min(1)
      .default('Asia/Ho_Chi_Minh')
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'APP_TIME_ZONE must be a valid IANA time zone'),
    CORS_ORIGINS: z.string().optional(),
    ADMIN_EMAILS: z.string().default(''),
    OBSIDIAN_SYNC_ENABLED: z.enum(['true', 'false']).default('false'),
    OBSIDIAN_VAULT_PATH: z.string().trim().min(1).optional(),
    OBSIDIAN_TIME_ZONE: z.string().trim().min(1).default('Asia/Ho_Chi_Minh'),
    OBSIDIAN_OWNER_EMAIL: z.string().email().optional(),
    OBSIDIAN_VAULT_ID: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_-]{2,63}$/, 'OBSIDIAN_VAULT_ID must be a lowercase identifier')
      .optional(),
    OBSIDIAN_BRIDGE_ENABLED: z.enum(['true', 'false']).default('false'),
    OBSIDIAN_BRIDGE_TOKEN: z.string().min(32).optional(),
    GOOGLE_CLIENT_ID: z.string().trim().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().trim().min(1).optional(),
    FACEBOOK_APP_ID: z.string().trim().min(1).optional(),
    FACEBOOK_APP_SECRET: z.string().trim().min(1).optional(),
    EMAIL_DELIVERY_ENABLED: z.enum(['true', 'false']).default('false'),
    EMAIL_HOST: z.string().trim().min(1).optional(),
    EMAIL_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    EMAIL_SECURE: z.enum(['true', 'false']).default('false'),
    EMAIL_USER: z.string().trim().min(1).optional(),
    EMAIL_PASS: z.string().min(1).optional(),
    EMAIL_FROM: z.string().trim().min(1).default('Prepify <noreply@prepify.dev>'),
  })
  .superRefine((env, context) => {
    if (env.EMAIL_DELIVERY_ENABLED !== 'true') return;
    for (const key of ['EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS'] as const) {
      if (!env[key])
        context.addIssue({ code: 'custom', path: [key], message: `${key} is required` });
    }
  });

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  sessionSecret: string;
  contentRoot?: string;
  session: {
    cookieName: string;
    secure: boolean;
    ttlHours: number;
  };
  frontendUrl: string;
  publicApiUrl: string;
  timeZone: string;
  corsOrigins: string[];
  adminEmails: string[];
  obsidian: {
    enabled: boolean;
    vaultPath?: string;
    timeZone: string;
    ownerEmail?: string;
    vaultId: string;
    bridge: {
      enabled: boolean;
      token?: string;
    };
  };
  oauth: {
    google?: { clientId: string; clientSecret: string };
    facebook?: { clientId: string; clientSecret: string };
  };
  email: {
    enabled: boolean;
    host?: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
  };
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Identity of the single hosted vault. The server never learns its filesystem
 * path, which exists only on the owner's machine.
 */
const DEFAULT_VAULT_ID = 'vault-main';

export function loadConfig(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): AppConfig {
  // Treat blank values as unset: copying `.env.example` leaves optional
  // placeholders (OAuth, SMTP) as empty strings rather than omitting them.
  const normalized = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const env = environmentSchema.parse(normalized);
  const obsidianEnabled = env.OBSIDIAN_SYNC_ENABLED === 'true';
  const bridgeEnabled = env.OBSIDIAN_BRIDGE_ENABLED === 'true';

  if (obsidianEnabled && env.HOST !== '127.0.0.1' && env.HOST !== '::1') {
    throw new Error('Obsidian sync requires a loopback HOST');
  }

  if (obsidianEnabled && !env.OBSIDIAN_VAULT_PATH) {
    throw new Error('OBSIDIAN_VAULT_PATH is required when Obsidian sync is enabled');
  }

  if (bridgeEnabled && !env.OBSIDIAN_BRIDGE_TOKEN) {
    throw new Error('OBSIDIAN_BRIDGE_TOKEN is required when the hosted bridge is enabled');
  }

  // Without an owner identity the server starts happily and then rejects every
  // bridge authentication and Journey request, so fail at startup instead.
  if (bridgeEnabled && !env.OBSIDIAN_OWNER_EMAIL) {
    throw new Error('OBSIDIAN_OWNER_EMAIL is required when the hosted bridge is enabled');
  }

  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together');
  }
  if (Boolean(env.FACEBOOK_APP_ID) !== Boolean(env.FACEBOOK_APP_SECRET)) {
    throw new Error('FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be configured together');
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    databaseUrl: env.DATABASE_URL,
    sessionSecret: env.SESSION_SECRET,
    contentRoot: env.CONTENT_ROOT,
    session: {
      cookieName: env.NODE_ENV === 'production' ? '__Host-prepify_session' : 'prepify_session',
      secure: env.NODE_ENV === 'production',
      ttlHours: env.SESSION_TTL_HOURS,
    },
    frontendUrl: env.FRONTEND_URL,
    publicApiUrl: env.PUBLIC_API_URL,
    timeZone: env.APP_TIME_ZONE,
    corsOrigins: splitList(env.CORS_ORIGINS ?? env.FRONTEND_URL),
    adminEmails: splitList(env.ADMIN_EMAILS).map((email) => email.toLowerCase()),
    obsidian: {
      enabled: obsidianEnabled,
      vaultPath: env.OBSIDIAN_VAULT_PATH,
      timeZone: env.OBSIDIAN_TIME_ZONE,
      ownerEmail: env.OBSIDIAN_OWNER_EMAIL?.toLowerCase(),
      vaultId: env.OBSIDIAN_VAULT_ID ?? DEFAULT_VAULT_ID,
      bridge: {
        enabled: bridgeEnabled,
        ...(env.OBSIDIAN_BRIDGE_TOKEN ? { token: env.OBSIDIAN_BRIDGE_TOKEN } : {}),
      },
    },
    oauth: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {}),
      ...(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET
        ? { facebook: { clientId: env.FACEBOOK_APP_ID, clientSecret: env.FACEBOOK_APP_SECRET } }
        : {}),
    },
    email: {
      enabled: env.EMAIL_DELIVERY_ENABLED === 'true',
      host: env.EMAIL_HOST,
      port: env.EMAIL_PORT,
      secure: env.EMAIL_SECURE === 'true',
      user: env.EMAIL_USER,
      password: env.EMAIL_PASS,
      from: env.EMAIL_FROM,
    },
  };
}
