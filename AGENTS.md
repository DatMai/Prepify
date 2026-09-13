# AGENTS.md — Prepify

## Agent workflow

- Before any response or action, discover and invoke every relevant installed skill.
- Superpowers is the process authority. Read its current skills at runtime; never reproduce or improvise their workflows in this repository.
- This file contains only Prepify-specific context and constraints.

## Product

Prepify is a private-first technical interview study app with a public reading homepage, an admin-only Library, and an Obsidian-backed Journey.

The public homepage carries a curated programming RSS feed: `GET /api/v1/feed` is anonymous-readable and links out to the original articles.

- Frontend: Vite + vanilla TypeScript.
- Backend: Express + TypeScript.
- Database: PostgreSQL.
- Authentication: opaque PostgreSQL sessions in HttpOnly cookies and bcrypt.
- Human setup and current commands: `README.md`.

## Source of truth

- PostgreSQL owns identity, roles, sessions, quiz progress, streaks, and operational app data.
- PostgreSQL also owns the Library corpus and the Daily pool: topics, sections, questions, and Daily entries. The reader API projects them back to the previous JSON shapes.
- Obsidian owns Daily, Journey, knowledge, and theory Markdown.
- The Obsidian bridge is local-only. It may mutate only its allowlisted Daily surface and must preserve revision conflict protection.
- `content/*.json` is the Vietnamese corpus snapshot and the seed source, no longer the runtime source of truth. `content/en/*.json` mirrors its filenames, keys, and schema. Neither is ever mutated; see `docs/ADR-004-library-corpus-in-postgresql.md`.
- The Home feed stores nothing. It is a read-only server-side projection of public third-party RSS; the sources own their content.

## Non-negotiable constraints

- Enforce Library and Journey authorization on the server, never only in the frontend.
- The Home feed is link-out only: never republish or translate a third-party article, and never host or hotlink third-party images. Attribution never replaces permission.
- Never bundle the private content corpus into the production frontend.
- Add database changes as new append-only migrations; never rewrite an applied migration. Run `npm --prefix server run migrate` after pulling migrations.
- Never print or commit secrets, tokens, password hashes, or personal vault content.
- Preserve unrelated working-tree edits. Inspect `git status` before editing and stage only files owned by the current task.
- Do not push unless the user explicitly requests it.

## Canonical commands

```bash
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
npm run check
npm run check:bundle
npm run check:release-boundaries
npm --prefix server run migrate
npm --prefix server run seed:library
npm --prefix server run typecheck
npm --prefix server test
npm --prefix server run build
```

## Architecture references

- Journey/Obsidian write boundary: `docs/ADR-001-obsidian-journey-sync.md`.
- Private Library and projection boundary: `docs/ADR-002-private-library-and-obsidian-projection.md`.
- Public Home feed and third-party content boundary: `docs/ADR-003-public-rss-feed.md`.
- Library corpus ownership: `docs/ADR-004-library-corpus-in-postgresql.md`.
- Approved agent design: `docs/superpowers/specs/2026-09-11-agent-workflow-design.md`.
