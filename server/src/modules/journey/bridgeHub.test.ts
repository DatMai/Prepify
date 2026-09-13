import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  BRIDGE_UPGRADE_PATH,
  createBridgeAuthenticator,
  createBridgeHub,
  extractBearerToken,
  tokensMatch,
  type BridgeHub,
} from './bridgeHub';

/** Artificial credential for tests only; never a real bridge token. */
const TEST_TOKEN = 'prepify-bridge-test-credential-0123456789abcdef';
const OWNER_ID = '3f1a0f2e-6c1d-4f5a-9b2c-7d4e5f6a7b8c';
const PLAIN_PATH = '/api/v1/journey';
const MESSAGE_TIMEOUT = 2_000;

const servers: Server[] = [];
const hubs: BridgeHub[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const hub of hubs.splice(0)) await hub.close();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

interface Collector {
  messages: Record<string, unknown>[];
  waitForRequested(count: number): Promise<void>;
}

function collect(socket: WebSocket): Collector {
  const messages: Record<string, unknown>[] = [];
  socket.on('message', (data) => {
    messages.push(JSON.parse(String(data)) as Record<string, unknown>);
  });
  return {
    messages,
    async waitForRequested(count) {
      await vi.waitFor(
        () => {
          expect(messages.length).toBeGreaterThanOrEqual(count);
        },
        { timeout: MESSAGE_TIMEOUT },
      );
    },
  };
}

async function startHubServer(hub: BridgeHub): Promise<string> {
  const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  servers.push(server);
  hub.attach(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `ws://127.0.0.1:${port}${BRIDGE_UPGRADE_PATH}`;
}

function openSocket(url: string, headers: Record<string, string> = {}): WebSocket {
  const socket = new WebSocket(url, { headers });
  sockets.push(socket);
  return socket;
}

function bearerSocket(url: string, token = TEST_TOKEN): WebSocket {
  return openSocket(url, { Authorization: `Bearer ${token}` });
}

/** Resolves with the HTTP status the server answered an upgrade with. */
function upgradeStatus(socket: WebSocket): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      socket.terminate();
      resolve(status);
    });
    socket.once('error', (error: Error) => {
      const match = /Unexpected server response: (\d+)/.exec(error.message);
      resolve(match ? Number(match[1]) : 0);
    });
    socket.once('open', () => reject(new Error('expected the upgrade to be rejected')));
  });
}

function closeEvent(socket: WebSocket): Promise<number> {
  return new Promise<number>((resolve) => {
    socket.once('close', (code) => resolve(code));
  });
}

function authenticator(resolveOwnerId: () => string | null = () => OWNER_ID) {
  return vi.fn(
    createBridgeAuthenticator({
      token: TEST_TOKEN,
      resolveOwnerId,
    }),
  );
}

function buildHub(overrides: {
  authenticate?: ReturnType<typeof authenticator>;
  loadPending?: (ownerId: string) => Promise<string[]>;
}): { hub: BridgeHub; loadPending: ReturnType<typeof vi.fn> } {
  const loadPending = vi.fn(overrides.loadPending ?? (async () => [] as string[]));
  const hub = createBridgeHub({
    authenticate: overrides.authenticate ?? authenticator(),
    loadPending,
  });
  hubs.push(hub);
  return { hub, loadPending };
}

describe('bridge token comparison', () => {
  it('extracts only a bearer credential', () => {
    expect(extractBearerToken('Bearer credential-value')).toBe('credential-value');
    expect(extractBearerToken('bearer credential-value')).toBe('credential-value');
    expect(extractBearerToken('Basic credential-value')).toBeNull();
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('compares tokens in constant time and never throws on length mismatch', () => {
    expect(tokensMatch('same-value', 'same-value')).toBe(true);
    expect(tokensMatch('same-value', 'other-value')).toBe(false);
    expect(tokensMatch('same-value', 'same-value-longer')).toBe(false);
    expect(tokensMatch('same-value', '')).toBe(false);
  });
});

describe('bridge hub upgrades', () => {
  it('rejects an upgrade that carries no Authorization header', async () => {
    const { hub } = buildHub({});
    const url = await startHubServer(hub);

    const status = await upgradeStatus(openSocket(url));

    expect(status).toBe(401);
    expect(hub.isConnected(OWNER_ID)).toBe(false);
  });

  it('rejects an upgrade with the wrong token', async () => {
    const { hub } = buildHub({});
    const url = await startHubServer(hub);

    const status = await upgradeStatus(
      bearerSocket(url, 'prepify-bridge-wrong-credential-0123456789'),
    );

    expect(status).toBe(401);
    expect(hub.isConnected(OWNER_ID)).toBe(false);
  });

  it('rejects a token supplied through the query string', async () => {
    const { hub } = buildHub({});
    const url = await startHubServer(hub);

    const status = await upgradeStatus(openSocket(`${url}?token=${TEST_TOKEN}`));

    expect(status).toBe(401);
  });

  it('rejects an authenticated owner that cannot be resolved', async () => {
    const { hub } = buildHub({ authenticate: authenticator(() => null) });
    const url = await startHubServer(hub);

    const status = await upgradeStatus(bearerSocket(url));

    expect(status).toBe(401);
  });

  it('rejects an upgrade on any path other than the bridge endpoint', async () => {
    const { hub } = buildHub({});
    const url = await startHubServer(hub);

    const status = await upgradeStatus(
      bearerSocket(`${url.replace(BRIDGE_UPGRADE_PATH, PLAIN_PATH)}`),
    );

    expect(status).toBe(404);
    expect(hub.isConnected(OWNER_ID)).toBe(false);
  });

  it('accepts a bridge connection with the configured token', async () => {
    const { hub, loadPending } = buildHub({ loadPending: async () => ['job-1', 'job-2'] });
    const url = await startHubServer(hub);

    const socket = bearerSocket(url);
    const collector = collect(socket);
    await collector.waitForRequested(1);

    expect(hub.isConnected(OWNER_ID)).toBe(true);
    expect(loadPending).toHaveBeenCalledTimes(1);
    expect(loadPending).toHaveBeenCalledWith(OWNER_ID);
  });
});

describe('bridge hub notifications', () => {
  it('sends only job identifiers when pending work is announced', async () => {
    const { hub } = buildHub({ loadPending: async () => ['job-1', 'job-2'] });
    const url = await startHubServer(hub);

    const collector = collect(bearerSocket(url));
    await collector.waitForRequested(1);

    expect(collector.messages[0]).toEqual({ type: 'sync_available', jobIds: ['job-1', 'job-2'] });
    expect(Object.keys(collector.messages[0])).toEqual(['type', 'jobIds']);
  });

  it('notifies a connected bridge immediately when work becomes available', async () => {
    const pending: string[] = [];
    const { hub } = buildHub({ loadPending: async () => [...pending] });
    const url = await startHubServer(hub);

    const collector = collect(bearerSocket(url));
    await collector.waitForRequested(1);
    expect(collector.messages[0]).toEqual({ type: 'sync_available', jobIds: [] });

    pending.push('job-7');
    await hub.notifyOwner(OWNER_ID);
    await collector.waitForRequested(2);

    expect(collector.messages[1]).toEqual({ type: 'sync_available', jobIds: ['job-7'] });
  });

  it('never fails the caller when pending work cannot be loaded', async () => {
    const { hub } = buildHub({
      loadPending: async () => {
        throw new Error('database offline');
      },
    });
    const url = await startHubServer(hub);

    const collector = collect(bearerSocket(url));
    await vi.waitFor(() => {
      expect(hub.isConnected(OWNER_ID)).toBe(true);
    });

    await expect(hub.notifyOwner(OWNER_ID)).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(collector.messages).toHaveLength(0);
  });

  it('ignores notification for an owner that has no bridge', async () => {
    const { hub, loadPending } = buildHub({});
    await startHubServer(hub);

    await expect(hub.notifyOwner('another-owner')).resolves.toBeUndefined();
    expect(loadPending).not.toHaveBeenCalled();
    expect(hub.isConnected('another-owner')).toBe(false);
  });
});

describe('bridge hub reconnect', () => {
  it('sends one pending-work message after reconnect', async () => {
    const pending: string[] = [];
    const { hub, loadPending } = buildHub({ loadPending: async () => pending });
    const url = await startHubServer(hub);

    const first = bearerSocket(url);
    const firstCollector = collect(first);
    await firstCollector.waitForRequested(1);
    expect(hub.isConnected(OWNER_ID)).toBe(true);

    first.terminate();
    await vi.waitFor(() => {
      expect(hub.isConnected(OWNER_ID)).toBe(false);
    });

    pending.push('job-after-reconnect');
    const second = bearerSocket(url);
    const secondCollector = collect(second);
    await secondCollector.waitForRequested(1);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(secondCollector.messages).toEqual([
      { type: 'sync_available', jobIds: ['job-after-reconnect'] },
    ]);
    expect(loadPending).toHaveBeenCalledTimes(2);
    expect(hub.isConnected(OWNER_ID)).toBe(true);
  });
});

describe('bridge hub shutdown', () => {
  it('closes live sockets and stops accepting upgrades', async () => {
    const { hub } = buildHub({});
    const url = await startHubServer(hub);

    const socket = bearerSocket(url);
    const collector = collect(socket);
    await collector.waitForRequested(1);
    const closed = closeEvent(socket);

    await hub.close();

    expect(await closed).toBe(1001);
    expect(hub.isConnected(OWNER_ID)).toBe(false);
  });
});
