import { describe, expect, it } from 'vitest';
import { bridgeWsUrl, loadBridgeConfig } from './config';

describe('loadBridgeConfig', () => {
  const base = {
    PREPIFY_API_URL: 'https://prepify.example.com',
    OBSIDIAN_BRIDGE_TOKEN: 'bridge-token-0123456789abcdef0123456789',
    OBSIDIAN_VAULT_PATH: '/Users/owner/second-brain',
    OBSIDIAN_VAULT_ID: 'vault-main',
  };

  it('parses the four bridge environment variables', () => {
    const config = loadBridgeConfig(base);

    expect(config).toEqual({
      apiUrl: 'https://prepify.example.com',
      token: 'bridge-token-0123456789abcdef0123456789',
      vaultPath: '/Users/owner/second-brain',
      vaultId: 'vault-main',
    });
  });

  it('strips a trailing slash from the API URL', () => {
    expect(
      loadBridgeConfig({ ...base, PREPIFY_API_URL: 'https://prepify.example.com/' }).apiUrl,
    ).toBe('https://prepify.example.com');
  });

  it('defaults the vault identity to vault-main', () => {
    expect(loadBridgeConfig({ ...base, OBSIDIAN_VAULT_ID: undefined }).vaultId).toBe('vault-main');
  });

  it('rejects a non-http API URL', () => {
    expect(() => loadBridgeConfig({ ...base, PREPIFY_API_URL: 'file:///etc/passwd' })).toThrow();
    expect(() => loadBridgeConfig({ ...base, PREPIFY_API_URL: 'not a url' })).toThrow();
    expect(() => loadBridgeConfig({ ...base, PREPIFY_API_URL: undefined })).toThrow();
  });

  it('rejects a missing or short bridge token', () => {
    expect(() => loadBridgeConfig({ ...base, OBSIDIAN_BRIDGE_TOKEN: 'short-token' })).toThrow();
    expect(() => loadBridgeConfig({ ...base, OBSIDIAN_BRIDGE_TOKEN: undefined })).toThrow();
  });

  it('rejects a relative vault path', () => {
    expect(() =>
      loadBridgeConfig({ ...base, OBSIDIAN_VAULT_PATH: 'relative/second-brain' }),
    ).toThrow();
  });

  it('rejects an invalid vault identity', () => {
    expect(() => loadBridgeConfig({ ...base, OBSIDIAN_VAULT_ID: 'Bad Vault' })).toThrow();
  });
});

describe('bridgeWsUrl', () => {
  it('derives a ws endpoint from an http API URL', () => {
    expect(bridgeWsUrl('http://localhost:3001')).toBe('ws://localhost:3001/api/v1/journey/bridge');
  });

  it('derives a wss endpoint from an https API URL', () => {
    expect(bridgeWsUrl('https://prepify.example.com')).toBe(
      'wss://prepify.example.com/api/v1/journey/bridge',
    );
  });
});
