# Codex Superpowers Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Prepify's legacy Claude workflow and establish one concise Codex entrypoint that delegates process to the official Superpowers plugin.

**Architecture:** `AGENTS.md` owns only stable Prepify context and constraints. Official Superpowers skills remain external and are discovered at runtime; the official Codex marketplace package and upstream adapter provide the process implementation.

**Tech Stack:** Markdown, shell verification, Git

**Spec:** `docs/superpowers/specs/2026-09-11-agent-workflow-design.md`

## Global Constraints

- Do not vendor, rewrite, summarize, or fork upstream Superpowers skills inside Prepify.
- Delete `.claude/` and root `CLAUDE.md`; do not migrate their command framework.
- Keep `README.md`, both accepted ADRs, and `docs/superpowers/`.
- Preserve every unrelated dirty working-tree change.
- Install through the official Codex marketplace; never edit plugin caches.
- Use Superpowers `6.3.0`, matching the audited upstream release.
- Apply only the upstream-required Codex adapter keys in `~/.codex/config.toml`.
- Do not push.

---

### Task 1: Replace the legacy Claude layer with the Codex project contract

**Files:**

- Create: `AGENTS.md`
- Delete: `CLAUDE.md`
- Delete: `.claude/.DS_Store`
- Delete: `.claude/commands/.DS_Store`
- Delete: `.claude/commands/README.md`
- Delete: `.claude/commands/db/migrate.md`
- Delete: `.claude/commands/db/new-migration.md`
- Delete: `.claude/commands/dev/kill-ports.md`
- Delete: `.claude/commands/dev/start.md`
- Delete: `.claude/commands/dev/typecheck.md`
- Delete: `.claude/commands/feature/.DS_Store`
- Delete: `.claude/commands/feature/authentication/forgot-password.md`
- Delete: `.claude/commands/feature/authentication/login.md`
- Delete: `.claude/commands/feature/authentication/register.md`
- Delete: `.claude/commands/feature/content/add-questions.md`
- Delete: `.claude/commands/feature/content/add-topic.md`
- Delete: `.claude/commands/feature/content/import.md`
- Delete: `.claude/commands/feature/content/new-section.md`
- Delete: `.claude/commands/feature/content/review.md`
- Delete: `.claude/commands/feature/daily-challenge.md`
- Delete: `.claude/commands/feature/favorites.md`
- Delete: `.claude/commands/feature/language-toggle.md`
- Delete: `.claude/commands/feature/leaderboard-streak.md`
- Delete: `.claude/commands/feature/profile-detail.md`
- Delete: `.claude/launch.json`
- Delete: `.claude/notes/quiz-redesign.md`
- Delete: `.claude/notes/ui-guidelines.md`
- Delete: `.claude/settings.local.json`

**Interfaces:**

- Consumes: project facts from `README.md`, ADR-001, ADR-002, and current package scripts.
- Produces: one root instruction contract automatically discovered by Codex.

- [x] **Step 1: Capture the existing dirty-file boundary**

Run:

```bash
git status --short > /tmp/prepify-agent-reset-before.txt
```

Expected: the file records all pre-existing application edits so the final diff can be checked without staging them.

- [x] **Step 2: Run the contract check and observe RED**

Run:

```bash
test -f AGENTS.md && test ! -e CLAUDE.md && test ! -e .claude
```

Expected: non-zero exit because `AGENTS.md` is absent and the legacy Claude files exist.

- [x] **Step 3: Create the minimal Codex entrypoint**

Create `AGENTS.md` with this exact structure and content:

````markdown
# AGENTS.md — Prepify

## Agent workflow

- Before any response or action, discover and invoke every relevant installed skill.
- Superpowers is the process authority. Read its current skills at runtime; never reproduce or improvise their workflows in this repository.
- This file contains only Prepify-specific context and constraints.

## Product

Prepify is a private-first technical interview study app with a public reading homepage, an admin-only Library, and an Obsidian-backed Journey.

- Frontend: Vite + vanilla TypeScript.
- Backend: Express + TypeScript.
- Database: PostgreSQL.
- Authentication: JWT and bcrypt.
- Human setup and current commands: `README.md`.

## Source of truth

- PostgreSQL owns identity, roles, sessions, quiz progress, streaks, and operational app data.
- Obsidian owns Daily, Journey, knowledge, and theory Markdown.
- The Obsidian bridge is local-only. It may mutate only its allowlisted Daily surface and must preserve revision conflict protection.
- `content/*.json` is the Vietnamese corpus. `content/en/*.json` mirrors its filenames, keys, and schema.

## Non-negotiable constraints

- Enforce Library and Journey authorization on the server, never only in the frontend.
- Never bundle the private content corpus into the production frontend.
- Add database changes as new append-only migrations; never rewrite an applied migration.
- Never print or commit secrets, tokens, password hashes, or personal vault content.
- Preserve unrelated working-tree edits. Inspect `git status` before editing and stage only files owned by the current task.
- Do not push unless the user explicitly requests it.

## Canonical commands

```bash
npm run dev
npm run typecheck
npm run build
npm --prefix server run typecheck
npm --prefix server test
npm --prefix server run build
```
````

## Architecture references

- Journey/Obsidian write boundary: `docs/ADR-001-obsidian-journey-sync.md`.
- Private Library and projection boundary: `docs/ADR-002-private-library-and-obsidian-projection.md`.
- Approved agent design: `docs/superpowers/specs/2026-09-11-agent-workflow-design.md`.

````

- [x] **Step 4: Delete the legacy Claude files**

Delete exactly the files listed under **Files**, then remove the empty `.claude/` directories. Do not delete any `.claude` or `CLAUDE.md` path under dependencies or sibling repositories.

- [x] **Step 5: Run the contract check and observe GREEN**

Run:

```bash
test -f AGENTS.md && test ! -e CLAUDE.md && test ! -e .claude
test -f README.md
test -f docs/ADR-001-obsidian-journey-sync.md
test -f docs/ADR-002-private-library-and-obsidian-projection.md
test -f docs/superpowers/specs/2026-09-11-agent-workflow-design.md
! rg -n 'Three Paths|RED, GREEN|subagent-driven-development|finishing-a-development-branch' AGENTS.md
````

Expected: every command exits `0`; the final negative search proves the project file does not copy workflow internals.

- [x] **Step 6: Run project verification**

Run:

```bash
npm run typecheck
npm --prefix server run typecheck
npm --prefix server test
npm run build
npm --prefix server run build
```

Expected: all commands exit `0`. If a command fails, report the exact failure and determine whether it existed in the pre-existing dirty application state; do not change unrelated app code during this task.

- [x] **Step 7: Verify scope and commit**

Run:

```bash
git diff --check -- AGENTS.md CLAUDE.md docs/superpowers
git status --short
git diff --cached --name-status
git add AGENTS.md CLAUDE.md docs/superpowers/plans/2026-09-11-codex-superpowers-reset.md
git diff --cached --name-status
git commit -m "chore: chuyển quy trình agent sang Codex"
```

Expected before commit: staged paths contain only `AGENTS.md`, deletion of `CLAUDE.md`, and the plan; `.claude/` is ignored and therefore removed from disk but absent from Git history. Expected after commit: unrelated working-tree changes remain unstaged.

---

### Task 2: Activate the official Superpowers runtime for Codex

**Files:**

- Modify outside repository: `~/.codex/config.toml`
- Install through official marketplace: `superpowers@openai-curated-remote`

**Interfaces:**

- Consumes: official Codex marketplace package `6.3.0` and the current Codex spawn allowlist.
- Produces: enabled upstream skills plus multi-agent defaults for future Codex sessions.

- [x] **Step 1: Confirm the official marketplace version**

Run:

```bash
codex plugin list --available --json
```

Expected: `superpowers@openai-curated-remote` is available at version `6.3.0`.

- [x] **Step 2: Install the official package**

Run:

```bash
codex plugin add superpowers@openai-curated-remote --json
```

Expected: exit `0` with version `6.3.0` and an official cache path.

- [x] **Step 3: Apply the Codex adapter settings**

Update only these keys in `~/.codex/config.toml`:

```toml
[agents]
default_subagent_model = "gpt-5.6-terra"
default_subagent_reasoning_effort = "medium"

[features]
multi_agent = true
```

- [x] **Step 4: Verify installation and upstream identity**

Run:

```bash
codex plugin list --available --json
SUPERPOWERS_AUDIT_DIR=$(mktemp -d)
git clone https://github.com/obra/superpowers.git "$SUPERPOWERS_AUDIT_DIR"
git -C "$SUPERPOWERS_AUDIT_DIR" checkout b36e0829c6d0140e93cfef2ca599b1b07d4a7797
shasum -a 256 \
  "$SUPERPOWERS_AUDIT_DIR/skills/using-superpowers/SKILL.md" \
  ~/.codex/plugins/cache/openai-curated-remote/superpowers/6.3.0/skills/using-superpowers/SKILL.md
```

Expected: the plugin is installed and enabled at `6.3.0`; both hashes are identical. Repeat the hash comparison for `brainstorming`, `writing-plans`, `executing-plans`, and `verification-before-completion`.

- [x] **Step 5: Preserve the session boundary**

Do not claim that this already-running session reloaded the plugin. Start the next Prepify session normally and confirm the official Superpowers skills appear in its available skill catalog.
