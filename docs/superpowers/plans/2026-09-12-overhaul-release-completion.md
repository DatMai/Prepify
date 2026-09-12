# Prepify Overhaul Release Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining release gaps in the approved full-overhaul design and produce a locally merged, verified `main` branch without pushing.

**Architecture:** Keep one modular Express process and one Vite frontend. The composition root injects configuration and persistence, every state-changing learning result is server-derived, real corpus files remain local and ignored, and the existing local Obsidian bridge is made an explicit adapter while projection/outbox work is represented by durable PostgreSQL records.

**Tech Stack:** TypeScript, Express 5, PostgreSQL, Vite 7, Vitest, Zod, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-12-prepify-full-overhaul-design.md`

## Global Constraints

- Preserve Home, login/logout, Library, Journey, Quiz, progress, and VI/EN flows.
- Library and Journey remain server-enforced admin-only resources.
- PostgreSQL owns identity and operational state; Obsidian owns knowledge and Daily Markdown.
- No real private corpus may be bundled into the frontend or tracked as an application fixture.
- Database changes are append-only migrations.
- `npm run check` is the local and CI definition of green.
- Do not push.

---

### Task 1: Versioned API and consistent browser client

**Files:**

- Modify: `server/src/index.ts`
- Modify: `server/src/middleware/errorHandler.ts`
- Modify: `src/api/client.ts`
- Modify: `src/api/streak.ts`
- Test: `server/src/app.test.ts`
- Test: `src/api/client.test.ts`

**Interfaces:**

- Consumes: existing Express routers and cookie-session middleware.
- Produces: `/api/v1/*` routes and one shared `apiRequest<T>()` client.

- [x] Write failing API tests proving `/api/v1/auth/session` is mounted and failures use `{ error: { code, message, requestId } }` without internal details.
- [x] Run the focused tests and capture RED.
- [x] Mount application routes under `/api/v1`, keep OAuth callback configuration on the same versioned path, and centralize browser requests through `apiRequest<T>()`.
- [x] Run frontend/server focused tests and typechecks.
- [x] Commit with `refactor: thống nhất hợp đồng api`.

### Task 2: Inject all runtime configuration at the composition root

**Files:**

- Modify: `server/src/config/env.ts`
- Modify: `server/src/config/env.test.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/services/adminBootstrap.ts`
- Modify: `server/src/services/obsidianVault.ts`
- Modify: `server/src/routes/journey.ts`
- Modify: `server/src/utils/email.ts`
- Test: `server/src/services/obsidianMarkdown.test.ts`

**Interfaces:**

- Consumes: validated `AppConfig`.
- Produces: `createObsidianVault(config)`, `createJourneyRouter(deps)`, `createMailer(config)`, and `syncConfiguredAdmins(query, emails)` with no runtime `process.env` reads outside composition/bootstrap entrypoints.

- [x] Add failing tests for injected time zone/vault path and configured admin emails.
- [x] Confirm RED.
- [x] Convert environment-reading modules into factories and inject them from `index.ts`.
- [x] Search `server/src` and prove only `index.ts` and `db/migrate.ts` read `process.env`.
- [x] Run server tests/typecheck and commit with `refactor: cô lập cấu hình runtime`.

### Task 3: Server-owned learning results

**Files:**

- Create: `server/src/modules/learning/streak.ts`
- Create: `server/src/modules/learning/streak.test.ts`
- Modify: `server/src/routes/streak.ts`
- Modify: `server/src/routes/daily.ts`
- Modify: `server/src/routes/quizSessions.ts`
- Modify: `src/api/streak.ts`
- Modify: `src/quiz/quizView.ts`

**Interfaces:**

- Consumes: authenticated user ID, `APP_TIME_ZONE`, sealed daily challenge answers.
- Produces: deterministic `dateInTimeZone()`, `computeStreak()`, and server-derived stored scores.

- [ ] Write failing boundary tests around local midnight and duplicated/missing submitted answers.
- [ ] Confirm RED.
- [x] Share one injected clock/time-zone implementation between Daily and streak routes.
- [x] Stop accepting arbitrary quiz score fields unless accompanied by a server-issued answer challenge; until server-issued quiz attempts exist, store only non-scored flashcard activity.
- [x] Run focused and full tests, then commit with `fix: bảo vệ tính toàn vẹn học tập`.

Task 3 verification (2026-09-12): the time-zone boundary tests passed (2 files,
13 tests), and the full `npm run check` passed, including 105 frontend tests,
224 server tests, production builds, the private bundle scan, and production
audits with 0 vulnerabilities. Migration `012_make_quiz_score_nullable.sql`
was not applied locally because `DATABASE_URL` and `SESSION_SECRET` were not
available in the environment.

### Task 4: Private corpus boundary

**Files:**

- Modify: `.gitignore`
- Modify: `server/src/config/env.ts`
- Modify: `server/.env.example`
- Modify: `server/src/index.ts`
- Modify: `README.md`
- Create: `server/test-fixtures/content/index.json`
- Create: `server/test-fixtures/content/sample.json`
- Test: `src/security/privateBundleScan.test.ts`

**Interfaces:**

- Consumes: `CONTENT_ROOT` pointing to an owner-controlled directory.
- Produces: ignored local corpus at `content/` and committed synthetic fixtures for tests.

- [ ] Write a failing repository privacy test that inspects `git ls-files content` and rejects tracked corpus files.
- [ ] Confirm RED.
- [ ] Add validated `CONTENT_ROOT`, inject it into Library/Daily adapters, and document local setup.
- [ ] Remove existing corpus paths from the Git index with `git rm --cached` while preserving working files on disk; ignore `/content/`.
- [ ] Run bundle/repository privacy tests and commit with `security: tách corpus cá nhân khỏi git`.

### Task 5: Durable Journey projection/outbox schema

**Files:**

- Create: `server/migrations/009_add_content_projection_and_journey_outbox.sql`
- Create: `server/src/modules/journey/outboxRepository.ts`
- Create: `server/src/modules/journey/outboxRepository.test.ts`
- Modify: `server/src/routes/journey.ts`
- Modify: `docs/ADR-001-obsidian-journey-sync.md`
- Modify: `docs/ADR-002-private-library-and-obsidian-projection.md`

**Interfaces:**

- Consumes: structured Journey mutation, idempotency key, expected revision.
- Produces: append-only `content_projections`, `journey_mutations`, and `audit_events`; hosted API enqueues mutations and local adapter remains the only vault writer.

- [ ] Write failing repository tests for unique idempotency, expected revision, claim, success, and conflict transitions.
- [ ] Confirm RED.
- [ ] Add the append-only migration and parameterized repository methods.
- [ ] Route hosted mutations to the outbox and local trusted mode through the atomic vault adapter; never let a hosted request touch a vault path.
- [ ] Run migration/static SQL tests and commit with `feat: thêm projection và journey outbox`.

### Task 6: Release evidence and documentation

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/plans/2026-09-12-identity-session-implementation.md`
- Modify: this plan

**Interfaces:**

- Consumes: completed implementation and fresh command output.
- Produces: documentation matching reality and a clean local `main`.

- [ ] Run `npm run check`, `git diff --check`, secret-pattern scan, tracked-corpus scan, and migration ordering checks.
- [ ] Perform a local HTTP smoke test for health, login failure, session restore, protected Library, Daily challenge, and logout without printing credentials.
- [ ] Update README/ADRs/AGENTS and mark only genuinely completed plan checkboxes.
- [ ] Commit documentation with `docs: đồng bộ kiến trúc prepify`.
- [ ] Fetch branch metadata without pushing; update local `main` safely, merge the overhaul branch, rerun `npm run check` on `main`, and delete the local feature branch only after success.
