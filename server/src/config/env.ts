import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  DATABASE_URL: z.string().trim().min(1),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().optional(),
  ADMIN_EMAILS: z.string().default(''),
  OBSIDIAN_SYNC_ENABLED: z.enum(['true', 'false']).default('false'),
  OBSIDIAN_VAULT_PATH: z.string().trim().min(1).optional(),
  OBSIDIAN_TIME_ZONE: z.string().trim().min(1).default('Asia/Ho_Chi_Minh'),
  OBSIDIAN_OWNER_EMAIL: z.string().email().optional(),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  sessionSecret: string;
  session: {
    cookieName: string;
    secure: boolean;
    ttlHours: number;
  };
  frontendUrl: string;
  corsOrigins: string[];
  adminEmails: string[];
  obsidian: {
    enabled: boolean;
    vaultPath?: string;
    timeZone: string;
    ownerEmail?: string;
  };
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): AppConfig {
  const env = environmentSchema.parse(source);
  const obsidianEnabled = env.OBSIDIAN_SYNC_ENABLED === 'true';

  if (obsidianEnabled && env.HOST !== '127.0.0.1' && env.HOST !== '::1') {
    throw new Error('Obsidian sync requires a loopback HOST');
  }

  if (obsidianEnabled && !env.OBSIDIAN_VAULT_PATH) {
    throw new Error('OBSIDIAN_VAULT_PATH is required when Obsidian sync is enabled');
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    databaseUrl: env.DATABASE_URL,
    sessionSecret: env.SESSION_SECRET,
    session: {
      cookieName: env.NODE_ENV === 'production' ? '__Host-prepify_session' : 'prepify_session',
      secure: env.NODE_ENV === 'production',
      ttlHours: env.SESSION_TTL_HOURS,
    },
    frontendUrl: env.FRONTEND_URL,
    corsOrigins: splitList(env.CORS_ORIGINS ?? env.FRONTEND_URL),
    adminEmails: splitList(env.ADMIN_EMAILS).map((email) => email.toLowerCase()),
    obsidian: {
      enabled: obsidianEnabled,
      vaultPath: env.OBSIDIAN_VAULT_PATH,
      timeZone: env.OBSIDIAN_TIME_ZONE,
      ownerEmail: env.OBSIDIAN_OWNER_EMAIL?.toLowerCase(),
    },
  };
}
