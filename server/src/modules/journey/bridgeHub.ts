import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

/**
 * The single endpoint the local bridge may upgrade. No other path is ever
 * accepted, and the bridge credential travels only in request headers — never
 * in the URL.
 */
export const BRIDGE_UPGRADE_PATH = '/api/v1/journey/bridge';

const SYNC_AVAILABLE = 'sync_available';
const CLOSE_GOING_AWAY = 1001;
const SHUTDOWN_GRACE_MS = 1_000;

export type BridgeAuthenticate = (
  request: IncomingMessage,
) => string | null | Promise<string | null>;

export type BridgeLoadPending = (ownerId: string) => Promise<readonly string[]> | readonly string[];

export interface BridgeHubLogger {
  info?(input: unknown, message?: string): void;
  warn?(input: unknown, message?: string): void;
}

export interface BridgeHubDependencies {
  /** Resolves the vault owner for an upgrade request, or null when unauthenticated. */
  authenticate: BridgeAuthenticate;
  /** Pending job identifiers for an owner. Only identifiers cross the wire. */
  loadPending: BridgeLoadPending;
  logger?: BridgeHubLogger;
}

export interface BridgeHub {
  attach(server: Server): void;
  notifyOwner(ownerId: string): Promise<void>;
  isConnected(ownerId: string): boolean;
  close(): Promise<void>;
}

/** Reads a bearer credential from the Authorization header only. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+([^ ]+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

/**
 * Compares two credentials in constant time. Both sides are hashed first so
 * `timingSafeEqual` always receives equal-length buffers and the comparison
 * leaks neither the token contents nor its length.
 */
export function tokensMatch(expected: string, provided: string): boolean {
  const expectedDigest = createHash('sha256').update(expected).digest();
  const providedDigest = createHash('sha256').update(provided).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

export interface BridgeAuthenticatorDependencies {
  token: string;
  /** Resolves the owner identity behind the credential; null rejects the upgrade. */
  resolveOwnerId(): string | null | Promise<string | null>;
}

export function createBridgeAuthenticator(
  deps: BridgeAuthenticatorDependencies,
): BridgeAuthenticate {
  return async (request) => {
    const provided = extractBearerToken(request.headers.authorization);
    if (provided === null || !tokensMatch(deps.token, provided)) return null;
    return await deps.resolveOwnerId();
  };
}

export function createBridgeHub(deps: BridgeHubDependencies): BridgeHub {
  const connections = new Map<string, Set<WebSocket>>();
  let hubServer: Server | undefined;
  let webSocketServer: WebSocketServer | undefined;
  let upgradeListener:
    ((request: IncomingMessage, socket: Duplex, head: Buffer) => void) | undefined;

  function rejectUpgrade(socket: Duplex, status: string): void {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  async function sendPending(ws: WebSocket, ownerId: string): Promise<void> {
    let jobIds: readonly string[];
    try {
      jobIds = await deps.loadPending(ownerId);
    } catch (error) {
      // Durable jobs stay in PostgreSQL; a failed lookup only delays notification.
      deps.logger?.warn?.({ ownerId, err: error }, 'bridge pending work lookup failed');
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: SYNC_AVAILABLE, jobIds: [...jobIds] }));
  }

  function register(ws: WebSocket, ownerId: string): void {
    const owned = connections.get(ownerId) ?? new Set<WebSocket>();
    connections.set(ownerId, owned);
    owned.add(ws);
    ws.on('close', () => {
      owned.delete(ws);
      if (owned.size === 0) connections.delete(ownerId);
    });
    ws.on('error', (error: Error) => {
      deps.logger?.warn?.({ ownerId, err: error }, 'bridge socket error');
    });
    // The bridge performs no filesystem work while idle; each connection is
    // answered with exactly one pending-work message.
    void sendPending(ws, ownerId);
  }

  async function handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const active = webSocketServer;
    if (!active) {
      rejectUpgrade(socket, '503 Service Unavailable');
      return;
    }
    let pathname: string;
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    } catch {
      rejectUpgrade(socket, '400 Bad Request');
      return;
    }
    if (pathname !== BRIDGE_UPGRADE_PATH) {
      rejectUpgrade(socket, '404 Not Found');
      return;
    }
    let ownerId: string | null;
    try {
      ownerId = await deps.authenticate(request);
    } catch (error) {
      deps.logger?.warn?.({ err: error }, 'bridge authentication failed');
      ownerId = null;
    }
    if (!ownerId) {
      rejectUpgrade(socket, '401 Unauthorized');
      return;
    }
    if (socket.destroyed || !socket.writable) return;
    const owner = ownerId;
    active.handleUpgrade(request, socket, head, (ws) => register(ws, owner));
  }

  function attach(server: Server): void {
    if (upgradeListener) throw new Error('bridge hub is already attached');
    hubServer = server;
    webSocketServer = new WebSocketServer({ noServer: true });
    upgradeListener = (request, socket, head) => {
      void handleUpgrade(request, socket, head);
    };
    server.on('upgrade', upgradeListener);
  }

  async function notifyOwner(ownerId: string): Promise<void> {
    const owned = connections.get(ownerId);
    if (!owned || owned.size === 0) return;
    await Promise.all([...owned].map((ws) => sendPending(ws, ownerId)));
  }

  function isConnected(ownerId: string): boolean {
    return (connections.get(ownerId)?.size ?? 0) > 0;
  }

  async function close(): Promise<void> {
    const active = webSocketServer;
    if (!active) return;
    if (hubServer && upgradeListener) hubServer.off('upgrade', upgradeListener);
    upgradeListener = undefined;
    webSocketServer = undefined;

    const live = [...connections.values()].flatMap((owned) => [...owned]);
    const force = setTimeout(() => {
      for (const ws of live) ws.terminate();
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    for (const ws of live) {
      try {
        ws.close(CLOSE_GOING_AWAY, 'server shutting down');
      } catch {
        ws.terminate();
      }
    }
    await new Promise<void>((resolve) => {
      active.close(() => resolve());
    });
    clearTimeout(force);
    connections.clear();
    hubServer = undefined;
  }

  return { attach, notifyOwner, isConnected, close };
}
