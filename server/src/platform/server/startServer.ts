import type { Server } from 'node:http';
import type { Express } from 'express';
import type { Logger } from 'pino';

export interface ServerRuntime {
  server: Server;
  stop(): Promise<void>;
}

export interface StartServerDependencies {
  app: Express;
  host: string;
  port: number;
  logger: Logger;
  /**
   * Closes protocols attached to the HTTP server (for example WebSocket
   * sockets) before the server stops accepting connections.
   */
  beforeClose?: () => Promise<void> | void;
  closePool(): Promise<void>;
}

function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      reject(new Error('HTTP server did not close within 10 seconds'));
    }, 10_000);
    timeout.unref();

    server.close((error) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function startServer({
  app,
  host,
  port,
  logger,
  beforeClose,
  closePool,
}: StartServerDependencies): Promise<ServerRuntime> {
  const server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(port, host, () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });

  const address = server.address();
  logger.info(
    { host, port: typeof address === 'object' && address ? address.port : port },
    'server listening',
  );

  let stopPromise: Promise<void> | undefined;
  return {
    server,
    stop() {
      stopPromise ??= (async () => {
        await beforeClose?.();
        await closeHttpServer(server);
        await closePool();
      })();
      return stopPromise;
    },
  };
}
