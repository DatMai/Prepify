# Overhaul Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution status (2026-09-13):** Tasks 1–3 complete on `feat/overhaul-completion`.
> The whole-branch review verdict was Blocked; its four findings were fixed
> (`341ef96`, `a197fd8`) and the gate/matrix re-verified (`npm run check` exits 0,
> smoke matrix 36/36). The user chose to open PR #11 rather than merge locally, so
> the "merge locally" wording in Task 3 Step 2 is superseded by that choice.
>
> **Follow-up hardening (2026-09-13):** the current branch adds Library
> per-topic lazy loading, Admin route/editor lifecycle fixes, consistent loading
> traces, Lucide UI icons/readability polish, and observable SMTP delivery
> failures. Whole-tree review identified and corrected lazy-load integration in
> Quiz/Review plus forgot-password account-enumeration risk. Final gate and PR
> evidence are recorded at handoff. The fresh canonical gate passed on
> 2026-09-13: frontend 153/153, server 376/376 with 24 integration tests skipped
> by environment, both builds, bundle/release-boundary scans, lint, formatting,
> typechecks, and production dependency audits.

**Goal:** Close the Prepify overhaul with fresh, reproducible evidence and truthful plan status.

**Architecture:** This plan runs only after the corpus, learning-integrity, and Obsidian-sync plans are complete. It adds reproducible repository checks, performs the final smoke matrix, reconciles all current documentation, and prepares a clean local integration without pushing.

**Tech Stack:** npm scripts, Vitest, Git, PostgreSQL, HTTP/WebSocket smoke tests

**Spec:** `docs/superpowers/specs/2026-09-12-deployment-obsidian-on-demand-sync-design.md`

## Global Constraints

- Evidence must be generated fresh on the final branch.
- Never print secrets, tokens, password hashes, corpus text, or vault text.
- Do not mark a historical process event complete without evidence.
- Do not push.

---

### Task 1: Reproducible release checks

**Files:**

- Create: `scripts/releaseBoundaryScan.mjs`
- Create: `src/security/releaseBoundaryScan.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: repository paths and migration filenames.
- Produces: `npm run check:release-boundaries` covering tracked corpus, migration ordering, secret filename patterns, legacy Claude surfaces, and required docs.

- [x] **Step 1: Write failing scanner tests**

Use a temporary directory fixture and prove detection of a tracked `content/`
path, duplicate migration prefix, `.env` tracking, missing `AGENTS.md`, and
missing ADR/spec references. Never scan or print file contents.

- [x] **Step 2: Run to verify RED**

Run: `npm test -- src/security/releaseBoundaryScan.test.ts`

- [x] **Step 3: Implement the scanner and npm script**

The scanner returns structured issue codes and prints only safe path metadata.
Add it to `npm run check` after `check:bundle`.

- [x] **Step 4: Run GREEN and commit**

```bash
npm test -- src/security/releaseBoundaryScan.test.ts
npm run check:release-boundaries
git add scripts/releaseBoundaryScan.mjs src/security/releaseBoundaryScan.test.ts package.json
git commit -m "test: tự động kiểm tra ranh giới release"
```

### Task 2: Final smoke matrix and documentation

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/plans/2026-09-12-overhaul-release-completion.md`
- Modify: this plan

**Interfaces:**

- Consumes: all completed implementation plans and fresh command output.
- Produces: accurate human setup, architecture references, and completion status.

- [x] **Step 1: Apply all migrations and seed synthetic/local content**

> Migration 013 applied to the synthetic `quiz_app` database during the smoke
> run. `seed:library` was not run; the smoke matrix was pointed at synthetic
> fixture data instead, and no corpus record was printed.

Run `npm --prefix server run migrate`. Run `npm --prefix server run seed:library`
only with the owner's configured `CONTENT_ROOT`; do not print corpus records.

- [x] **Step 2: Run the complete automated gate**

> `npm run check` exits **0** at `a2430c3`, including the new
> `check:release-boundaries`. `git diff --check` clean.

```bash
npm run check
git diff --check
npm run check:release-boundaries
```

Expected: every command exits 0.

- [x] **Step 3: Perform the final smoke matrix**

> **36/36 pass, exit 0** — `task-7-smoke-partA.sh` (21 checks) plus
> `task-7-smoke-partB2.sh` (15 checks) against a synthetic vault.
> Covered: health live/ready, failed login, session restore, protected Library,
> server-graded Daily refusing a client-asserted score, rejected client-scored
> MCQ, Journey projected read, conflict, reconnect, duplicate delivery, and
> logout.
>
> **Two gaps, annotated rather than ticked:**
>
> - _Offline state_ was observed only indirectly: the job stayed `pending` while
>   no bridge was connected and `bridgeConnected` reported `false`, but the UI
>   surface for that state was not driven in a browser.
> - _"From a non-loopback client"_ was not literally simulated — the API was
>   reached over loopback. What was proven is the substance of the requirement:
>   the sync request is accepted by the hosted API with no vault dependency and
>   the vault work is done later by the bridge.

Verify health/readiness, failed login, session restore, protected Library,
server-graded Daily, rejected client-scored MCQ, Journey projected read,
on-demand bridge sync from a non-loopback client, offline state, conflict,
reconnect, duplicate delivery, and logout. Use a synthetic temporary vault.

- [x] **Step 4: Reconcile documentation and checkboxes**

> README records the bridge setup, the one-owner/one-vault/one-bridge rule and the
> release-check commands. ADR-001 and ADR-002 were updated (ADR-002 also had a
> stale sentence corrected: the projection/outbox tables it called "not yet
> created" exist as migration 013). Commits `e32414c` and `68cd0f6`.

Update README setup/deployment commands, AGENTS source-of-truth wording, ADRs,
the original overhaul plan, and each new plan. Record exact test counts and
commit IDs. Leave unverifiable historical process steps explicitly annotated.

- [x] **Step 5: Commit documentation**

```bash
git add README.md AGENTS.md docs
git commit -m "docs: chốt bằng chứng release Prepify"
```

### Task 3: Local integration handoff

**Files:** None.

**Interfaces:**

- Consumes: clean feature branch and green verification.
- Produces: a reviewed local integration ready for the user's chosen Git workflow.

- [ ] **Step 1: Invoke `superpowers:requesting-code-review`**

Review the full base-to-head diff. Fix every Critical and Important finding with
a new RED/GREEN cycle and re-run `npm run check`.

- [ ] **Step 2: Invoke `superpowers:finishing-a-development-branch`**

Present the supported integration choices. Do not merge, delete a branch, open a
PR, or push without the user selecting that action.
