# Obsidian On-Demand Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a deployed Prepify instance synchronize allowlisted Daily and Journey state with a private Obsidian vault through an on-demand bridge running on the owner's Mac.

**Architecture:** Hosted requests commit structured state and durable jobs to PostgreSQL. A local bridge maintains one outbound authenticated WebSocket, claims jobs, performs revision-protected atomic vault writes, and uploads projections; the server never receives paths or arbitrary Markdown patches.

**Tech Stack:** Express 5, TypeScript, PostgreSQL, `ws`, Zod, Vitest, macOS `launchd`

**Spec:** `docs/superpowers/specs/2026-09-12-deployment-obsidian-on-demand-sync-design.md`

## Global Constraints

- Only the local bridge may access a vault path.
- Hosted routes never accept filesystem paths or arbitrary Markdown.
- Sync is user-triggered; no recurring job or filesystem polling.
- Bridge authentication is separate, scoped, revocable, and excluded from logs.
- Vault-backed Journey mutations are disabled while offline or conflicted;
  database-owned Daily quiz completion remains available and queues a summary.
- Database migrations are append-only.
- Do not push.

---

### Task 1: Durable projection, outbox, and audit repository

**Files:**

- Create: `server/migrations/013_add_journey_sync.sql`
- Create: `server/src/modules/journey/syncTypes.ts`
- Create: `server/src/modules/journey/syncRepository.ts`
- Create: `server/src/modules/journey/syncRepository.test.ts`

**Interfaces:**

- Consumes: parameterized `JourneyQuery` and transaction wrapper.
- Produces: `createSyncRepository({ query, withTransaction })` with `getProjection`, `requestSync`, `enqueueMutation`, `listPending`, `claim`, `complete`, `fail`, and `recordInboundProjection`.

- [ ] **Step 1: Write the migration**

Create `journey_projections`, `journey_sync_jobs`, and `journey_audit_events`.
Constrain job state to `pending|claimed|synced|conflict|failed`, make
`(owner_id, idempotency_key)` unique, and index pending jobs by owner and creation
time. Store structured JSONB payloads and hashes, never arbitrary paths.

- [ ] **Step 2: Write failing repository tests**

Assert parameterized SQL and state transitions:

```ts
await repo.requestSync({ ownerId, vaultId, idempotencyKey: 'event_12345678' });
await repo.claim({ ownerId, jobId, leaseId: 'lease-1', leaseSeconds: 30 });
await repo.complete({ ownerId, jobId, leaseId: 'lease-1', revision: sha, projection });
```

Prove duplicate idempotency returns the existing job, expired claims are
retryable, an incorrect lease cannot complete a job, and conflict preserves
both revision identifiers.

- [ ] **Step 3: Run to verify RED**

Run: `npm --prefix server test -- src/modules/journey/syncRepository.test.ts`

Expected: FAIL because the repository module does not exist.

- [ ] **Step 4: Implement minimal repository and types**

Define:

```ts
export type SyncState = 'pending' | 'claimed' | 'synced' | 'conflict' | 'failed';
export interface SyncStatus {
  jobId: string;
  state: SyncState;
  requestedAt: string;
  completedAt: string | null;
  bridgeConnected: boolean;
}
```

Every state-changing repository method inserts a sanitized audit event inside
the same transaction.

- [ ] **Step 5: Run GREEN, migration static test, and commit**

```bash
npm --prefix server test -- src/modules/journey/syncRepository.test.ts src/db/migrationRunner.test.ts
npm --prefix server run typecheck
git add server/migrations/013_add_journey_sync.sql server/src/modules/journey
git commit -m "feat: thêm outbox đồng bộ Journey"
```

### Task 2: Hosted Journey API and explicit sync jobs

**Files:**

- Create: `server/src/routes/journeySync.test.ts`
- Create: `server/src/routes/journey.test.ts`
- Modify: `server/src/routes/journey.ts`
- Modify: `server/src/routes/daily.ts`
- Modify: `server/src/routes/daily.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**

- Consumes: `SyncRepository`, `requireAuth`, `requireAdmin`, owner identity, and `notifyOwner(ownerId)`.
- Produces: `POST /api/v1/journey/sync`, `GET /api/v1/journey/sync/:jobId`,
  database-backed Journey reads/mutations, and a queued Daily completion summary.

- [ ] **Step 1: Write failing hosted route tests**

Assert a non-loopback authenticated owner can request sync without any vault
dependency, a non-admin gets 403, an owner mismatch gets 403, and a request body
containing `path` or `markdown` gets 400.

```ts
await request(app).post('/journey/sync').set('Idempotency-Key', 'sync_12345678').expect(202);
```

- [ ] **Step 2: Run to verify RED**

Run: `npm --prefix server test -- src/routes/journeySync.test.ts`

- [ ] **Step 3: Split local and hosted dependencies**

Retain the existing vault adapter only for an explicit local trusted mode.
Hosted mode reads `journey_projections`, writes canonical structured mutations,
and enqueues an outbox job in one transaction. It never calls `ObsidianVault`.

Inject `enqueueDailySummary({ ownerId, date, score, total, idempotencyKey })`
into the Daily router. After a successful database-owned completion, enqueue the
summary for the next sync; bridge unavailability does not roll back or reject the
Daily result. Add a route test proving a retry reuses the completion's stable
idempotency key.

- [ ] **Step 4: Implement sync status routes**

`POST /sync` returns `{ jobId, state: 'pending' }` with status 202 and invokes
`notifyOwner` after commit. `GET /sync/:jobId` returns only the caller's job and
includes current bridge connectivity.

- [ ] **Step 5: Verify and commit**

```bash
npm --prefix server test -- src/routes/journeySync.test.ts src/routes/journey.test.ts src/routes/daily.test.ts
npm --prefix server run typecheck
git add server/src/routes/journey.ts server/src/routes/journeySync.test.ts server/src/routes/daily.ts server/src/routes/daily.test.ts server/src/index.ts
git commit -m "feat: route Journey dùng projection và outbox"
```

### Task 3: Authenticated WebSocket notification channel

**Files:**

- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Modify: `server/src/config/env.ts`
- Modify: `server/src/config/env.test.ts`
- Create: `server/src/modules/journey/bridgeHub.ts`
- Create: `server/src/modules/journey/bridgeHub.test.ts`
- Modify: `server/src/platform/server/startServer.ts`
- Modify: `server/src/platform/server/startServer.test.ts`
- Modify: `server/src/index.ts`
- Modify: `server/.env.example`

**Interfaces:**

- Consumes: `OBSIDIAN_BRIDGE_TOKEN`, owner/vault identity, and HTTP upgrade requests.
- Produces: `createBridgeHub({ authenticate, loadPending })` with `attach(server)`, `notifyOwner(ownerId)`, `isConnected(ownerId)`, and `close()`.

- [ ] **Step 1: Add `ws` and write failing hub tests**

Install `ws` and `@types/ws`. Test rejection without `Authorization: Bearer`,
acceptance with the configured bridge token, immediate `sync_available`
notification, and one pending-work message after reconnect.

- [ ] **Step 2: Run to verify RED**

Run: `npm --prefix server test -- src/modules/journey/bridgeHub.test.ts`

- [ ] **Step 3: Validate bridge configuration**

Add optional `OBSIDIAN_BRIDGE_TOKEN` with minimum length 32. Require it when
hosted sync is enabled. Compare tokens with a constant-time function and never
put the token in a URL or log field.

- [ ] **Step 4: Implement and attach the hub**

Use the HTTP server returned by `startServer`. Accept upgrades only on
`/api/v1/journey/bridge`, authenticate headers before upgrading, send only job
identifiers, and close sockets during graceful shutdown.

- [ ] **Step 5: Verify and commit**

```bash
npm --prefix server test -- src/modules/journey/bridgeHub.test.ts src/platform/server/startServer.test.ts src/config/env.test.ts
npm --prefix server run typecheck
git add server/package.json server/package-lock.json server/src/config server/src/modules/journey/bridgeHub.ts server/src/modules/journey/bridgeHub.test.ts server/src/platform/server server/src/index.ts server/.env.example
git commit -m "feat: kênh báo sync cho HeheVault bridge"
```

### Task 4: Bridge HTTP contract

**Files:**

- Create: `server/src/routes/journeyBridge.ts`
- Create: `server/src/routes/journeyBridge.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**

- Consumes: Bearer bridge authentication and `SyncRepository`.
- Produces: claim, inbound projection, completion, conflict, and failure endpoints under `/api/v1/journey/bridge/jobs`.

- [ ] **Step 1: Write failing contract tests**

Test `GET /pending`, `POST /:id/claim`, `POST /:id/projection`,
`POST /:id/complete`, `POST /:id/conflict`, and `POST /:id/fail`. Assert browser
cookies cannot authenticate bridge routes and payloads containing paths or raw
Markdown are rejected.

- [ ] **Step 2: Run RED, implement Zod contracts, run GREEN**

Run before and after implementation:

`npm --prefix server test -- src/routes/journeyBridge.test.ts`

Request contracts carry stable IDs, structured Journey data, base/new SHA-256
revisions, lease IDs, and sanitized error codes.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/journeyBridge.ts server/src/routes/journeyBridge.test.ts server/src/index.ts
git commit -m "feat: hợp đồng API cho bridge Obsidian"
```

### Task 5: Local HeheVault bridge process

**Files:**

- Create: `server/src/bridge/bridgeClient.ts`
- Create: `server/src/bridge/bridgeClient.test.ts`
- Create: `server/src/bridge/index.ts`
- Create: `server/src/bridge/config.ts`
- Create: `server/src/bridge/config.test.ts`
- Modify: `server/src/services/obsidianVault.ts`
- Create: `server/src/services/obsidianVault.test.ts`
- Modify: `server/package.json`
- Create: `scripts/installHehevaultBridge.mjs`
- Create: `src/security/installHehevaultBridge.test.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: `PREPIFY_API_URL`, `OBSIDIAN_BRIDGE_TOKEN`, `OBSIDIAN_VAULT_PATH`, `OBSIDIAN_VAULT_ID`, and WebSocket job notifications.
- Produces: `runBridge(config, deps)` that claims, synchronizes, and acknowledges jobs exactly once.

- [ ] **Step 1: Write failing bridge and vault boundary tests**

Test notification → pending fetch → claim → vault snapshot → projection upload →
outbound mutation apply → completion. Also test duplicate notifications,
reconnect, stale revision, symlink escape, traversal, interrupted atomic write,
and offline API.

- [ ] **Step 2: Run to verify RED**

Run: `npm --prefix server test -- src/bridge src/services/obsidianVault.test.ts`

- [ ] **Step 3: Implement bridge configuration and client**

The process opens one WebSocket, performs no filesystem work while idle, and
checks pending jobs once after each successful connection. Network retry uses
bounded exponential backoff; job idempotency remains server-owned.

- [ ] **Step 4: Reuse the atomic allowlisted vault adapter**

Expose operations needed to read a structured snapshot and apply task, journal,
or evidence mutations. Resolve `Daily/YYYY-MM-DD.md` beneath the real vault root,
reject symlinks, compare SHA-256 revisions, and atomically rename a sibling
temporary file.

- [ ] **Step 5: Add local run and launchd installation**

Add `bridge:dev` and `bridge:start` scripts. The installer resolves the current
repository and Node executable paths, renders
`~/Library/LaunchAgents/com.prepify.hehevault-bridge.plist`, and never embeds the
bridge token or vault path. Its test redirects the destination to a temporary
directory and asserts the generated plist invokes `server/dist/bridge/index.js`.
README instructs the owner to keep secrets in a mode-0600
`server/.env.bridge.local` file. Running the installer remains an explicit human
setup step; tests never load or replace a real LaunchAgent.

- [ ] **Step 6: Verify and commit**

```bash
npm --prefix server test -- src/bridge src/services/obsidianVault.test.ts src/services/obsidianMarkdown.test.ts
npm test -- src/security/installHehevaultBridge.test.ts
npm --prefix server run typecheck
npm --prefix server run build
git add server/src/bridge server/src/services/obsidianVault.ts server/src/services/obsidianVault.test.ts server/package.json scripts/installHehevaultBridge.mjs src/security/installHehevaultBridge.test.ts README.md
git commit -m "feat: HeheVault bridge đồng bộ theo yêu cầu"
```

### Task 6: Journey and Daily synchronization UI

**Files:**

- Modify: `src/api/client.ts`
- Modify: `src/api/client.test.ts`
- Create: `src/journey/syncState.ts`
- Create: `src/journey/syncState.test.ts`
- Modify: `src/journey/journeyView.ts`
- Create: `src/journey/journeyView.test.ts`
- Modify: `src/daily/dailyView.ts`
- Create: `src/daily/dailyView.test.ts`
- Modify: `src/i18n/vi.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/styles/journey.css`

**Interfaces:**

- Consumes: `api.journey.requestSync(eventId)` and `api.journey.syncStatus(jobId)`.
- Produces: explicit Sync Obsidian control, visible state, and mutation gating.

- [ ] **Step 1: Write failing API and state tests**

```ts
expect(fetch).toHaveBeenCalledWith(
  expect.stringContaining('/journey/sync'),
  expect.objectContaining({ method: 'POST' }),
);
expect(canMutate({ state: 'bridge_offline' })).toBe(false);
expect(canMutate({ state: 'synced' })).toBe(true);
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/api/client.test.ts src/journey/syncState.test.ts src/journey/journeyView.test.ts`

- [ ] **Step 3: Implement API methods and pure state machine**

Define all six UI states from the spec. Poll only the status of a user-requested
job with a 30-second deadline; this is not recurring bridge polling.

- [ ] **Step 4: Implement the view**

Add the Sync Obsidian button, last-success timestamp, accessible live status,
retry action, and conflict guidance to Journey and Daily. Disable
task/journal/evidence mutations unless the current state is `synced`; keep
projected content and the database-owned Daily quiz readable and usable.

- [ ] **Step 5: Verify i18n parity, UI tests, and commit**

```bash
npm test -- src/api/client.test.ts src/journey/syncState.test.ts src/journey/journeyView.test.ts src/daily/dailyView.test.ts src/i18n/index.test.ts
npm run typecheck
npm run build
git add src/api/client.ts src/api/client.test.ts src/journey src/daily/dailyView.ts src/daily/dailyView.test.ts src/i18n src/styles/journey.css
git commit -m "feat: nút đồng bộ Obsidian theo yêu cầu"
```

### Task 7: End-to-end synchronization evidence

**Files:**

- Modify: `docs/ADR-001-obsidian-journey-sync.md`
- Modify: `docs/ADR-002-private-library-and-obsidian-projection.md`
- Modify: `docs/superpowers/plans/2026-09-12-overhaul-release-completion.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: all preceding tasks and a temporary synthetic vault.
- Produces: documented deployment boundary and completed release-plan Task 5.

- [ ] **Step 1: Run a local HTTP/WebSocket smoke test**

Using test credentials without printing them, prove: owner login, non-owner 403,
bridge authentication, phone-originated sync request, projection upload,
database-to-vault mutation, conflict, reconnect, duplicate notification, and
logout. Use a temporary synthetic vault, never the personal vault.

- [ ] **Step 2: Run the full gate**

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 3: Update ADRs and plan status**

Record the hybrid ownership boundary, local on-demand bridge, WebSocket
transport, offline behavior, and future cloud-mirror non-goal. Mark Task 5 only
after repository and smoke evidence exists.

- [ ] **Step 4: Commit**

```bash
git add docs/ADR-001-obsidian-journey-sync.md docs/ADR-002-private-library-and-obsidian-projection.md docs/superpowers/plans/2026-09-12-overhaul-release-completion.md README.md
git commit -m "docs: đồng bộ kiến trúc HeheVault bridge"
```
