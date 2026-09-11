# Prepify Codex Superpowers Design

**Date:** 2026-09-11

**Status:** Approved for implementation

**Upstream audited:** `obra/superpowers` `6.3.0`, commit
`b36e0829c6d0140e93cfef2ca599b1b07d4a7797`

## Goal

Reset Prepify's agent instructions around the official Superpowers methodology,
Codex first. Remove the old Claude-specific command system and replace it with
one small project entrypoint, `AGENTS.md`. Claude support is a separate future
phase.

## Chosen approach

Use Superpowers through Codex's official plugin mechanism. Do not vendor,
rewrite, summarize, or fork upstream skills inside Prepify. The repository owns
only product-specific context and invariants.

This is preferred over:

- keeping `.claude/` as a compatibility layer, which preserves two competing
  workflow systems;
- copying upstream skills into the repository, which creates a stale fork;
- building custom commands before the official workflow is proven useful.

## Changes

### Remove

- `.claude/` in full, including commands, notes, local settings, and launch
  configuration;
- root `CLAUDE.md`.

These are intentionally removed rather than migrated. Useful product facts are
represented by `README.md`, the ADRs, or the new `AGENTS.md`; Claude-specific
workflows will be designed later from a clean baseline.

### Keep

- `README.md` for human setup and product orientation;
- `docs/ADR-001-obsidian-journey-sync.md` and
  `docs/ADR-002-private-library-and-obsidian-projection.md` for product
  architecture;
- `docs/superpowers/specs/` and `docs/superpowers/plans/`, because the official
  architectural workflow writes approved specs and implementation plans there;
- every unrelated application change already present in the dirty worktree.

### Create

Create root `AGENTS.md` as the only Prepify-owned Codex entrypoint. It contains:

- product purpose and current stack;
- source-of-truth boundaries for PostgreSQL, Obsidian, and the bilingual
  content corpus;
- privacy, authorization, migration, and dirty-worktree invariants;
- canonical commands and links to `README.md` and accepted ADRs;
- a short instruction to discover and invoke relevant installed Superpowers
  skills before acting.

It must not reproduce Superpowers procedures. Exact brainstorming, planning,
TDD, worktree, review, and completion rules are loaded from the installed skill
at use time.

## Upstream installation

Official upstream says Codex App users install Superpowers from the official
Codex plugin marketplace. The official package
`superpowers@openai-curated-remote` version `6.3.0` is installed and enabled.
Selected core skill files have matching SHA-256 hashes against audited upstream
commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`.

Plugin caches were not patched or replaced by the temporary audit clone. A new
Codex session is required before the newly installed skill catalog can be
observed in session context.

The upstream Codex adapter settings are applied in `~/.codex/config.toml`:

```toml
[agents]
default_subagent_model = "gpt-5.6-terra"
default_subagent_reasoning_effort = "medium"

[features]
multi_agent = true
```

`gpt-5.6-terra` is a current mid-tier model from this Codex session's spawn
allowlist. Each future dispatch must still set both model and reasoning effort
as the upstream adapter requires.

## Prepify invariants

- Frontend is Vite with vanilla TypeScript; backend is Express with TypeScript.
- PostgreSQL owns identity, roles, sessions, and progress.
- Obsidian owns Journey, Daily, knowledge, and theory Markdown.
- The Obsidian bridge is local-only and may write only its allowlisted Daily
  surface with revision conflict protection.
- `content/*.json` is the Vietnamese corpus; `content/en/*.json` mirrors its
  filenames, keys, and schema.
- Library and Journey authorization is enforced by the server, never only by
  frontend visibility.
- Private corpus content must not be bundled into the production frontend.
- Database changes use new append-only migrations; applied migrations are not
  rewritten.
- Secrets, tokens, password hashes, and personal vault content are never
  printed or committed.
- Unrelated working-tree changes are preserved and never staged or committed by
  this refactor.

## Execution and verification

The implementation runs in the current checkout because the target files
include an intentionally modified `CLAUDE.md`; moving to a clean worktree would
omit that approved deletion. All unrelated dirty files remain untouched.

Verification must prove:

1. `.claude/` and `CLAUDE.md` no longer exist;
2. `AGENTS.md` exists and links only to existing project documentation;
3. `AGENTS.md` contains product rules but no copied Superpowers workflow;
4. the pre-existing dirty files outside this scope are unchanged;
5. the official Superpowers plugin reports version `6.3.0`, installed and
   enabled;
6. the Codex adapter settings are present;
7. project type-checks, tests, and builds pass.

Only the spec, plan, deletion of the old agent files, and new `AGENTS.md` may be
staged for this refactor. No push is performed.

## Definition of done

The phase is complete when the old Claude layer is gone, `AGENTS.md` is the sole
repository-owned Codex entrypoint, official Superpowers `6.3.0` and the Codex
adapter are active, verification evidence is fresh, and scoped changes are
committed without absorbing unrelated work.

The next Codex session must confirm skill discovery because this session began
before the official plugin was installed.
