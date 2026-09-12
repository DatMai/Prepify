# Prepify Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a tested, typed, secure application shell and a single reproducible quality gate before migrating Prepify's identity and product features.

**Architecture:** Keep the current application runnable while extracting a pure Express app factory, validated configuration, platform-owned database/logging, and shared HTTP errors. The root remains the orchestration package; frontend and server retain separate package manifests during this phase.

**Tech Stack:** Node.js 22.12+, TypeScript 5.9, Vite 7, Express 5, Vitest 4, Supertest 7, ESLint 9, Prettier 3, Zod 4, Helmet 8, Pino 10, PostgreSQL 8.

**Spec:** `docs/superpowers/specs/2026-09-12-prepify-full-overhaul-design.md`

## Global Constraints

- Preserve Home, login/logout, Library, Journey, Quiz, progress and VI/EN flows.
- No authentication credential is readable by browser JavaScript.
- Authorization remains enforced on the server.
- Real private corpus must not enter the frontend production bundle.
- Database changes remain append-only migrations.
- Preserve the existing dirty worktree; never discard or overwrite user changes.
- Do not push.
- Every implementation change follows red-green-refactor.
- `npm run check` is the local and CI definition of green.

---

### Task 1: Reproducible TypeScript Test Harness

**Files:**
- Modify: `package.json`
- Modify: `server/package.json`
- Modify: `package-lock.json`
- Modify: `server/package-lock.json`
- Create: `vitest.config.ts`
- Create: `server/vitest.config.ts`
- Create: `src/render/escape.test.ts`
- Modify: `server/src/services/obsidianMarkdown.test.ts`

**Interfaces:**
- Consumes: existing `esc`, `hl`, Obsidian Markdown and vault services.
- Produces: `npm test`, `npm --prefix server test`, and deterministic Vitest suites.

- [ ] **Step 1: Add a frontend characterization test before installing the runner**

```ts
import { describe, expect, it } from 'vitest';
import { esc, hl } from './escape';

describe('HTML-safe rendering helpers', () => {
  it('escapes markup and ampersands', () => {
    expect(esc('<script>a&b</script>')).toBe('&lt;script&gt;a&amp;b&lt;/script&gt;');
  });

  it('highlights a literal query without interpreting regular expressions', () => {
    expect(hl('Array.from(value)', 'Array.')).toBe(
      '<span class="hl">Array.</span>from(value)',
    );
  });
});
```

- [ ] **Step 2: Run the test command and verify the missing harness**

Run: `npm test`

Expected: FAIL because the root package does not yet define a `test` script or Vitest dependency.

- [ ] **Step 3: Install the test toolchain and add package scripts**

Run:

```bash
npm install --save-dev typescript@5.9.3 vite@7.3.6 vitest@4.1.11 jsdom@30.0.1
npm --prefix server install express@5.2.1 dotenv@17.4.2 pg@8.23.0 nodemailer@10.0.8 zod@4.6.2 helmet@8.3.0 pino@10.3.1 pino-http@11.0.0 express-rate-limit@8.7.0
npm --prefix server install --save-dev typescript@5.9.3 vitest@4.1.11 supertest@7.2.2 @types/supertest@7.2.1 @types/express@5.0.6 @types/node@24.13.4
```

Set the root scripts to:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:server": "npm --prefix server test"
}
```

Set the server test scripts to:

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 4: Add explicit Vitest configuration**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
```

`server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
```

- [ ] **Step 5: Convert the existing Node test imports to Vitest**

Replace `node:assert/strict` and `node:test` with:

```ts
import { afterEach, describe, expect, it } from 'vitest';
```

Keep the seven existing behaviors unchanged, express them with `expect`, and
move environment restoration into `afterEach` so a failed assertion cannot
leak process state into the next test.

- [ ] **Step 6: Run both suites**

Run: `npm test && npm --prefix server test`

Expected: PASS with 2 frontend assertions and all 7 existing Obsidian behaviors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server/package.json server/package-lock.json vitest.config.ts server/vitest.config.ts src/render/escape.test.ts server/src/services/obsidianMarkdown.test.ts
git commit -m "test: thiết lập Vitest cho Prepify"
```

---

### Task 2: Typed Fail-fast Configuration

**Files:**
- Create: `server/src/config/env.ts`
- Create: `server/src/config/env.test.ts`
- Modify: `server/src/db/client.ts`
- Modify: `server/src/db/migrate.ts`
- Modify: `server/.env.example`

**Interfaces:**
- Consumes: raw `NodeJS.ProcessEnv` and Zod.
- Produces: `loadConfig(env): AppConfig`, `AppConfig`, and `createPool(config.databaseUrl, logger)`.

- [ ] **Step 1: Write failing configuration tests**

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from './env';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://prepify:secret@localhost:5432/prepify_test',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  FRONTEND_URL: 'http://localhost:5173',
};

describe('loadConfig', () => {
  it('normalizes defaults and allowed origins', () => {
    const config = loadConfig(valid);
    expect(config.port).toBe(3001);
    expect(config.host).toBe('127.0.0.1');
    expect(config.corsOrigins).toEqual(['http://localhost:5173']);
  });

  it('fails before startup when required secrets are missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a remotely bound Obsidian bridge', () => {
    expect(() => loadConfig({
      ...valid,
      OBSIDIAN_SYNC_ENABLED: 'true',
      HOST: '0.0.0.0',
    })).toThrow(/Obsidian sync requires a loopback HOST/);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm --prefix server test -- src/config/env.test.ts`

Expected: FAIL because `loadConfig` does not exist.

- [ ] **Step 3: Implement the validated configuration contract**

```ts
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().optional(),
  ADMIN_EMAILS: z.string().default(''),
  OBSIDIAN_SYNC_ENABLED: z.enum(['true', 'false']).default('false'),
  OBSIDIAN_VAULT_PATH: z.string().optional(),
  OBSIDIAN_TIME_ZONE: z.string().default('Asia/Ho_Chi_Minh'),
  OBSIDIAN_OWNER_EMAIL: z.string().email().optional(),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  sessionSecret: string;
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

export function loadConfig(source: NodeJS.ProcessEnv | Record<string, string | undefined>): AppConfig {
  const env = schema.parse(source);
  const obsidianEnabled = env.OBSIDIAN_SYNC_ENABLED === 'true';
  if (obsidianEnabled && env.HOST !== '127.0.0.1' && env.HOST !== '::1') {
    throw new Error('Obsidian sync requires a loopback HOST');
  }

  const split = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    databaseUrl: env.DATABASE_URL,
    sessionSecret: env.SESSION_SECRET,
    frontendUrl: env.FRONTEND_URL,
    corsOrigins: split(env.CORS_ORIGINS ?? env.FRONTEND_URL),
    adminEmails: split(env.ADMIN_EMAILS).map((email) => email.toLowerCase()),
    obsidian: {
      enabled: obsidianEnabled,
      vaultPath: env.OBSIDIAN_VAULT_PATH,
      timeZone: env.OBSIDIAN_TIME_ZONE,
      ownerEmail: env.OBSIDIAN_OWNER_EMAIL?.toLowerCase(),
    },
  };
}
```

- [ ] **Step 4: Make the pool explicit instead of proxying global env**

```ts
import { Pool } from 'pg';
import type { Logger } from 'pino';

export function createPool(databaseUrl: string, logger: Logger): Pool {
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on('error', (error) => logger.error({ err: error }, 'unexpected database pool error'));
  return pool;
}
```

The composition root will create one pool and inject it. During migration of
legacy modules, export a temporary `setDatabasePool(pool)` accessor with a test
that throws when accessed before initialization; remove it in the later module
plans.

- [ ] **Step 5: Update migration startup and environment template**

Load dotenv only in the migration entry point, call `loadConfig(process.env)`,
create its pool explicitly, and close it in `finally`. Replace `JWT_SECRET` in
`server/.env.example` with a 32+ character `SESSION_SECRET` example and document
all validated keys without real values.

- [ ] **Step 6: Verify configuration, typecheck and migration compilation**

Run:

```bash
npm --prefix server test -- src/config/env.test.ts
npm --prefix server run typecheck
npm --prefix server run build
```

Expected: all commands PASS; invalid configuration never starts a listener.

- [ ] **Step 7: Commit**

```bash
git add server/src/config/env.ts server/src/config/env.test.ts server/src/db/client.ts server/src/db/migrate.ts server/.env.example
git commit -m "refactor: kiểm tra cấu hình khi khởi động"
```

---

### Task 3: Pure Express App Factory and HTTP Contract

**Files:**
- Create: `server/src/app.ts`
- Create: `server/src/app.test.ts`
- Create: `server/src/shared/errors/appError.ts`
- Create: `server/src/middleware/errorHandler.ts`
- Create: `server/src/middleware/requestId.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `AppConfig`, Pino logger, existing routers, Express 5.
- Produces: `createApp(deps): Express`, `AppError`, consistent error envelope, `/health/live`.

- [ ] **Step 1: Write failing app-shell integration tests**

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { AppError } from './shared/errors/appError';

describe('application shell', () => {
  it('returns liveness with a request id', async () => {
    const response = await request(createApp(testDependencies())).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('maps expected errors to the public envelope', async () => {
    const app = createApp({
      ...testDependencies(),
      registerRoutes(target) {
        target.get('/failure', () => { throw new AppError(403, 'AUTH_FORBIDDEN', 'Forbidden'); });
      },
    });
    const response = await request(app).get('/failure');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('does not leak unexpected exception details', async () => {
    const app = createApp({
      ...testDependencies(),
      registerRoutes(target) {
        target.get('/failure', () => { throw new Error('database password leaked'); });
      },
    });
    const response = await request(app).get('/failure');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('database password leaked');
  });
});
```

`testDependencies()` supplies the valid test config, a silent logger and a
route registrar that does nothing.

- [ ] **Step 2: Verify the app tests fail**

Run: `npm --prefix server test -- src/app.test.ts`

Expected: FAIL because the app factory and shared errors do not exist.

- [ ] **Step 3: Implement request IDs and typed application errors**

```ts
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
```

The request-ID middleware accepts an existing `x-request-id` only when it is a
valid UUID; otherwise it generates `randomUUID()`. It stores the value in
`res.locals.requestId` and returns it in the response header.

- [ ] **Step 4: Implement the centralized error mapper**

Expected errors use their status/code/message. Unexpected errors are logged
with `{ err, requestId }` and return:

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error",
    "requestId": "generated-uuid"
  }
}
```

- [ ] **Step 5: Implement `createApp`**

The factory applies, in order: request ID, Pino HTTP logging, Helmet, configured
CORS with credentials, JSON body limit `256kb`, Passport initialization,
registered application routes, `/health/live`, a JSON 404, and the error
handler. It does not read `process.env`, connect to PostgreSQL or listen.

```ts
export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  registerRoutes(app: Express): void;
}

export function createApp({ config, logger, registerRoutes }: AppDependencies): Express;
```

- [ ] **Step 6: Reduce `index.ts` to the composition root**

`index.ts` loads dotenv, validates config, creates logger/pool, initializes the
legacy database adapter, registers existing routers, runs admin bootstrap,
starts one HTTP server, and closes server/pool on `SIGINT` or `SIGTERM`.

- [ ] **Step 7: Verify integration, existing routes and build**

Run:

```bash
npm --prefix server test
npm --prefix server run typecheck
npm --prefix server run build
```

Expected: app-shell tests and all Obsidian tests PASS; existing route modules
compile without changing their public paths.

- [ ] **Step 8: Commit**

```bash
git add server/src/app.ts server/src/app.test.ts server/src/index.ts server/src/shared/errors/appError.ts server/src/middleware/errorHandler.ts server/src/middleware/requestId.ts
git commit -m "refactor: tách application shell khỏi server"
```

---

### Task 4: Readiness, Structured Logging, and Graceful Shutdown

**Files:**
- Create: `server/src/platform/logger/createLogger.ts`
- Create: `server/src/platform/server/startServer.ts`
- Create: `server/src/platform/server/startServer.test.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/app.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: Pino, PostgreSQL Pool, `createApp`.
- Produces: `createLogger(config)`, `startServer(deps)`, `/health/ready`, idempotent `stop()`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('reports not ready when the database check fails', async () => {
  const app = createApp({
    ...testDependencies(),
    readiness: async () => { throw new Error('offline'); },
  });
  const response = await request(app).get('/health/ready');
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ status: 'unavailable' });
});

it('closes the HTTP server and pool exactly once', async () => {
  const closeServer = vi.fn().mockResolvedValue(undefined);
  const closePool = vi.fn().mockResolvedValue(undefined);
  const runtime = await startServer({ ...fakeDependencies, closeServer, closePool });
  await Promise.all([runtime.stop(), runtime.stop()]);
  expect(closeServer).toHaveBeenCalledTimes(1);
  expect(closePool).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Verify lifecycle tests fail**

Run: `npm --prefix server test -- src/platform/server/startServer.test.ts src/app.test.ts`

Expected: FAIL because readiness and `startServer` do not exist.

- [ ] **Step 3: Implement redacted structured logging**

`createLogger` selects `debug` in development and `info` otherwise. Configure
Pino redaction for request authorization/cookie headers, response set-cookie,
passwords, reset tokens, session tokens and OAuth tokens. Do not add
`pino-pretty` to production dependencies.

- [ ] **Step 4: Add readiness**

Extend `AppDependencies` with `readiness(): Promise<void>`. `/health/ready`
runs it with a short timeout, returning only `{ "status": "ok" }` or a 503
`{ "status": "unavailable" }`; it never returns SQL details.

- [ ] **Step 5: Implement idempotent startup/shutdown**

`startServer` owns the Node HTTP server. Its returned `stop()` memoizes the
shutdown promise, stops accepting connections, waits at most ten seconds, then
closes the database pool. Signal handlers call the same function once.

- [ ] **Step 6: Verify lifecycle and build**

Run:

```bash
npm --prefix server test
npm --prefix server run typecheck
npm --prefix server run build
```

Expected: all tests PASS; repeated shutdown does not duplicate cleanup.

- [ ] **Step 7: Commit**

```bash
git add server/src/platform/logger/createLogger.ts server/src/platform/server/startServer.ts server/src/platform/server/startServer.test.ts server/src/app.ts server/src/app.test.ts server/src/index.ts
git commit -m "feat: thêm health check và graceful shutdown"
```

---

### Task 5: Formatting, Linting, CI, and the Single Quality Gate

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `.github/workflows/quality.yml`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: source files selected by Prettier

**Interfaces:**
- Consumes: all frontend/backend source, tests and builds.
- Produces: `npm run format:check`, `npm run lint`, `npm run check`, identical CI gate.

- [ ] **Step 1: Add the quality-gate scripts before their dependencies**

```json
{
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "lint": "eslint . --max-warnings 0",
  "check": "npm run format:check && npm run lint && npm run typecheck && npm --prefix server run typecheck && npm test && npm --prefix server test && npm run build && npm --prefix server run build"
}
```

- [ ] **Step 2: Verify the gate fails before setup**

Run: `npm run check`

Expected: FAIL because Prettier and ESLint are not installed/configured.

- [ ] **Step 3: Install and configure formatting/linting**

Run:

```bash
npm install --save-dev prettier@3.9.6 eslint@9.39.5 @eslint/js@9.39.5 typescript-eslint@8.70.0 globals@16.5.0
```

`.prettierrc.json`:

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

Ignore generated/build/private surfaces:

```text
node_modules
dist
server/dist
content
server/coverage
coverage
```

`eslint.config.js` applies ESLint recommended and TypeScript ESLint recommended
to `src/**/*.ts`, `server/src/**/*.ts`, config files and tests, with browser
globals for frontend and Node globals for server/scripts. Generated output and
the real content corpus are ignored. Warnings are not allowed.

- [ ] **Step 4: Format owned project files and fix lint findings**

Run `npm run format`, inspect the diff for semantic changes, then run
`npm run lint`. Fix findings rather than disabling rules globally. A narrow
disable requires a comment explaining the invariant.

- [ ] **Step 5: Add CI using the same gate**

`.github/workflows/quality.yml` checks out the repository, installs Node 24,
runs `npm ci`, runs `npm --prefix server ci`, and runs `npm run check`. It has
read-only repository permissions and no secrets.

- [ ] **Step 6: Document supported setup and branch isolation**

Update README to state Node `>=22.12`, the two-install setup, `npm run check`,
the current modular-overhaul status, and that private content is not a frontend
asset. Add `.worktrees/` to `.gitignore` for future clean tasks.

- [ ] **Step 7: Run the complete gate and production audits**

Run:

```bash
npm run check
npm audit --omit=dev
npm --prefix server audit --omit=dev
```

Expected: `npm run check` PASS; production audits report zero unexplained high
or critical vulnerabilities. Any remaining advisory is recorded with package,
reachability and an explicit remediation decision before continuing.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json eslint.config.js .prettierrc.json .prettierignore .github/workflows/quality.yml .gitignore README.md src server
git commit -m "chore: thiết lập quality gate thống nhất"
```

---

## Foundation Completion Checkpoint

Before starting the Identity plan:

```bash
git status --short
git log --oneline -8
npm run check
npm audit --omit=dev
npm --prefix server audit --omit=dev
```

Expected outcome:

- application behavior remains available;
- app creation and configuration are testable without listening;
- startup fails safely on invalid configuration;
- logs redact credentials;
- health and shutdown behavior are deterministic;
- one local/CI command is green;
- no push has occurred.
