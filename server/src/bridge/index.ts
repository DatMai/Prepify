import path from 'node:path';
import dotenv from 'dotenv';
import pino from 'pino';
import { WebSocket } from 'ws';
import { loadBridgeConfig } from './config';
import { runBridge, type BridgeHttp, type BridgeWebSocket } from './bridgeClient';
import { createObsidianVault } from '../services/obsidianVault';

// This entry compiles to server/dist/bridge/index.js (server/src/bridge in
// dev), so the vault-owned secret files live two directories up in server/.
// Secrets are only read from disk; they are never printed or embedded.
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true, quiet: true });
dotenv.config({
  path: path.resolve(__dirname, '../../.env.bridge.local'),
  override: true,
  quiet: true,
});

function connectWebSocket(url: string, headers: Record<string, string>): BridgeWebSocket {
  const socket = new WebSocket(url, { headers });
  return {
    on(event, listener) {
      socket.on(event, (...args: unknown[]) => listener(args[0]));
    },
    close() {
      socket.close();
    },
  };
}

async function main(): Promise<void> {
  const config = loadBridgeConfig(process.env);
  const vault = createObsidianVault({
    enabled: true,
    vaultPath: config.vaultPath,
    timeZone: config.timeZone,
  });

  // The bridge credential and the vault path are secrets: they are never logged.
  const logger = pino({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: { paths: ['token', '*.token', 'vaultPath', '*.vaultPath'], censor: '[Redacted]' },
  });

  const http: BridgeHttp = {
    async request(method, pathname, body) {
      const response = await fetch(`${config.apiUrl}${pathname}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        // A non-JSON body (for example an empty response) is fine to ignore.
      }
      return { status: response.status, body: parsed };
    },
  };

  const handle = runBridge(config, { http, connectWebSocket, vault, logger });
  logger.info({ apiUrl: config.apiUrl, vaultId: config.vaultId }, 'obsidian bridge started');

  const stop = (): void => {
    void handle.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
