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
- Authentication: opaque PostgreSQL sessions in HttpOnly cookies and bcrypt.
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

## Architecture references

- Journey/Obsidian write boundary: `docs/ADR-001-obsidian-journey-sync.md`.
- Private Library and projection boundary: `docs/ADR-002-private-library-and-obsidian-projection.md`.
- Approved agent design: `docs/superpowers/specs/2026-09-11-agent-workflow-design.md`.
