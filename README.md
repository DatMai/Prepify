# Prepify

Prepify is a private-first technical interview study app. The public Home page
carries a curated programming RSS feed; Library and Journey are protected admin
surfaces.

The project is currently executing the approved
[full-overhaul architecture](docs/superpowers/specs/2026-09-12-prepify-full-overhaul-design.md).

## Stack

- Vite 7 and vanilla TypeScript frontend
- Express 5 and TypeScript backend
- PostgreSQL operational database
- Vitest for frontend and backend tests
- Local-only Obsidian bridge for the current Journey implementation

## Requirements

- Node.js `>=22.12 <27`
- npm 11+
- PostgreSQL

Install the two packages once:

```bash
npm ci
npm --prefix server ci
```

Copy `server/.env.example` to `server/.env` and replace every placeholder
secret. Never commit the resulting file.

## Commands

```bash
npm run dev             # frontend :5173 and backend :3001
npm run dev:frontend    # frontend only
npm run dev:server      # backend only
npm test                # frontend tests
npm run test:server     # backend tests
npm run typecheck       # frontend typecheck
npm run build           # frontend production build
npm run format          # format owned source and documentation
npm run lint            # lint the complete repository
npm run check:bundle    # prove private corpus text is absent from dist
npm run audit:production # audit runtime dependencies only
npm run check           # canonical local and CI quality gate
```

Database migrations remain append-only:

```bash
npm --prefix server run migrate
```

## Current architecture

The Foundation phase has a pure Express app factory, validated configuration,
structured redacted logging, liveness/readiness endpoints, graceful shutdown,
and one quality gate. Existing product routes remain available while later
plans migrate identity, feature modules and Obsidian projection/outbox flows.

```text
Browser -> Express app -> feature routes -> PostgreSQL
                       -> feed service -> public third-party RSS (cached, link-out only)
                       -> local-only Obsidian bridge
```

The target architecture and migration order are documented in
`docs/superpowers/specs/2026-09-12-prepify-full-overhaul-design.md`.

## Public homepage feed

`GET /api/v1/feed?limit=<1..50>` (default 30) is anonymous-readable and returns
`{ items: [{ title, url, summary, source, publishedAt }] }`.

- Sources are a code-level list in `server/src/modules/feed/sources.ts`
  (VnExpress Số hóa, Viblo, TopDev, Hacker News, dev.to).
- The server fetches RSS/Atom itself (`http/https` only, 10s timeout, 1 MB cap),
  normalizes and dedupes items, and serves a 15-minute in-memory cache with a
  single in-flight refresh. Nothing is stored in PostgreSQL.
- A broken source is isolated; the rest of the feed still renders.

Content boundary (see [ADR-003](docs/ADR-003-public-rss-feed.md)):

- Link-out only: title, short excerpt, source name, time, and a link to the
  original article. Never republish or translate someone else's article.
- Never host or hotlink third-party images; visuals are Prepify-owned styling.
- Attribution never replaces permission.

Design and implementation records:
`docs/superpowers/specs/2026-09-12-home-rss-feed-design.md` and
`docs/superpowers/plans/2026-09-12-home-rss-feed-implementation.md`.

## Privacy and authorization

- Library and Journey authorization is checked by the server.
- The Home feed is public and read-only; it exposes no private data.
- The frontend build does not import the real `content/*.json` corpus.
- Current content is served through protected backend routes.
- The overhaul will replace repository-held real corpus files with an
  Obsidian-owned PostgreSQL projection and synthetic test fixtures.
- The Obsidian bridge must remain disabled on hosted environments.

## Local Obsidian bridge

Set these values only on a trusted machine that contains the vault:

```dotenv
HOST=127.0.0.1
OBSIDIAN_SYNC_ENABLED=true
OBSIDIAN_VAULT_PATH=/absolute/path/to/second-brain
OBSIDIAN_TIME_ZONE=Asia/Ho_Chi_Minh
OBSIDIAN_OWNER_EMAIL=owner@example.com
ADMIN_EMAILS=owner@example.com
```

The current bridge may read and update only its allowlisted Daily surface. It
uses revision checks and atomic writes so a stale browser cannot overwrite a
newer Obsidian note. See [ADR-001](docs/ADR-001-obsidian-journey-sync.md) and
[ADR-002](docs/ADR-002-private-library-and-obsidian-projection.md).

## Agent workflow

`AGENTS.md` is the project router. Superpowers is the process authority:

```text
brainstorm -> approved spec -> written plan -> isolated branch/worktree
-> failing test -> minimal implementation -> verification -> user review
```

Agents do not push without an explicit user request.
