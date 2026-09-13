import path from 'node:path';

/**
 * Configuration for the local HeheVault bridge. The bridge is the only
 * component permitted to know a vault path, and its credential is never placed
 * in a generated launchd plist or a log field.
 */
export interface BridgeConfig {
  /** Deployed API origin without a trailing slash, e.g. `https://prepify.example.com`. */
  apiUrl: string;
  /** The scoped, revocable bridge credential. Never logged or embedded in a plist. */
  token: string;
  /** Absolute path to the real Obsidian vault root. Local-only. */
  vaultPath: string;
  /** The single hosted vault identity the bridge synchronizes. */
  vaultId: string;
  /**
   * The time zone that decides which `Daily/YYYY-MM-DD.md` the bridge reads and
   * writes. It must match the server's `APP_TIME_ZONE`, or a deployment in
   * another zone syncs the wrong day's note.
   */
  timeZone: string;
}

const SAFE_VAULT_ID = /^[a-z][a-z0-9_-]{2,63}$/;
export const DEFAULT_VAULT_ID = 'vault-main';
export const DEFAULT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const BRIDGE_PATH = '/api/v1/journey/bridge';

/** The WebSocket endpoint the bridge holds open; the token travels only in headers. */
export function bridgeWsUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = BRIDGE_PATH;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function loadBridgeConfig(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): BridgeConfig {
  const env = source as Record<string, string | undefined>;
  const value = (key: string): string | undefined => {
    const raw = env[key];
    return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
  };

  const apiUrl = value('PREPIFY_API_URL');
  if (!apiUrl) throw new Error('PREPIFY_API_URL is required');
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new Error('PREPIFY_API_URL must be an absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('PREPIFY_API_URL must use http or https');
  }

  const token = value('OBSIDIAN_BRIDGE_TOKEN');
  if (!token || token.length < 32) {
    throw new Error('OBSIDIAN_BRIDGE_TOKEN must be at least 32 characters');
  }

  const vaultPath = value('OBSIDIAN_VAULT_PATH');
  if (!vaultPath || !path.isAbsolute(vaultPath)) {
    throw new Error('OBSIDIAN_VAULT_PATH must be an absolute path');
  }

  const vaultId = value('OBSIDIAN_VAULT_ID') ?? DEFAULT_VAULT_ID;
  if (!SAFE_VAULT_ID.test(vaultId)) {
    throw new Error('OBSIDIAN_VAULT_ID must be a lowercase identifier');
  }

  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    token,
    vaultPath,
    vaultId,
    // Deliberately the same variable the server reads for Daily, so one name
    // means one concept across both processes.
    timeZone: value('APP_TIME_ZONE') ?? DEFAULT_TIME_ZONE,
  };
}
