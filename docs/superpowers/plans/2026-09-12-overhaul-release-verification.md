# Overhaul Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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

- [ ] **Step 1: Write failing scanner tests**

Use a temporary directory fixture and prove detection of a tracked `content/`
path, duplicate migration prefix, `.env` tracking, missing `AGENTS.md`, and
missing ADR/spec references. Never scan or print file contents.

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/security/releaseBoundaryScan.test.ts`

- [ ] **Step 3: Implement the scanner and npm script**

The scanner returns structured issue codes and prints only safe path metadata.
Add it to `npm run check` after `check:bundle`.

- [ ] **Step 4: Run GREEN and commit**

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

- [ ] **Step 1: Apply all migrations and seed synthetic/local content**

Run `npm --prefix server run migrate`. Run `npm --prefix server run seed:library`
only with the owner's configured `CONTENT_ROOT`; do not print corpus records.

- [ ] **Step 2: Run the complete automated gate**

```bash
npm run check
git diff --check
npm run check:release-boundaries
```

Expected: every command exits 0.

- [ ] **Step 3: Perform the final smoke matrix**

Verify health/readiness, failed login, session restore, protected Library,
server-graded Daily, rejected client-scored MCQ, Journey projected read,
on-demand bridge sync from a non-loopback client, offline state, conflict,
reconnect, duplicate delivery, and logout. Use a synthetic temporary vault.

- [ ] **Step 4: Reconcile documentation and checkboxes**

Update README setup/deployment commands, AGENTS source-of-truth wording, ADRs,
the original overhaul plan, and each new plan. Record exact test counts and
commit IDs. Leave unverifiable historical process steps explicitly annotated.

- [ ] **Step 5: Commit documentation**

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
