# Home RSS Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Home RSS feed design (ADR-003) on the public Home page with TDD, then merge it to `main` through a reviewed pull request.

**Architecture:** Add a self-contained `modules/feed` unit (parser, fetcher, service, sources) behind one public Express route, and a `src/feed` frontend view mounted into `#homeRoot`'s Home section. No new infrastructure and no PostgreSQL writes.

**Tech Stack:** TypeScript, Express 5, Vite 7, Vitest, `rss-parser`, Zod, supertest.

**Spec:** `docs/superpowers/specs/2026-09-12-home-rss-feed-design.md`
**Decision record:** `docs/ADR-003-public-rss-feed.md`

## Global Constraints

- The endpoint is public and anonymous-readable; no session is required.
- Never republish or translate third-party articles, and never host third-party images.
- Every article link opens in a new tab with `rel="noopener noreferrer"`.
- All injected text goes through `esc()`; the view is otherwise DOM-built.
- No database migration, no admin UI, and no source management endpoint in this slice.
- `npm run check` remains the definition of green; work happens on an isolated branch/worktree.

---

### Task 1: Normalize RSS and Atom items

**Files:**

- Create: `server/src/modules/feed/parser.ts`
- Test: `server/src/modules/feed/parser.test.ts`

**Interfaces:**

- Produces: `FeedArticle = { title, url, summary, source, publishedAt }` and `parseFeedXml(source, xml): Promise<FeedArticle[]>`.

- [x] Write failing tests for RSS 2.0 and Atom normalization, skipping items without a title or link, newest-first sorting with undated items last, and 280-character truncation.
- [x] Confirm RED (`Cannot find module './parser'`).
- [x] Implement the parser with `rss-parser`, HTML stripping, markdown cleanup, duplicated-title removal, and stable sorting.
- [x] Confirm GREEN (7 tests).

### Task 2: Fetch external feeds safely

**Files:**

- Create: `server/src/modules/feed/fetcher.ts`
- Test: `server/src/modules/feed/fetcher.test.ts`

**Interfaces:**

- Produces: `createFeedFetcher({ fetchImpl?, timeoutMs?, maxBytes? })` with `fetchXml(url): Promise<string>`.

- [x] Write failing tests for non-`http(s)` rejection without a network call, success, non-2xx failure, byte-cap failure, and timeout abort.
- [x] Confirm RED.
- [x] Implement scheme validation, `AbortController` timeout, `redirect: 'follow'`, an identifying `User-Agent`, and a 1 MB cap.
- [x] Confirm GREEN (5 tests).

### Task 3: Cache and merge sources with isolation

**Files:**

- Create: `server/src/modules/feed/feedService.ts`
- Create: `server/src/modules/feed/sources.ts`
- Test: `server/src/modules/feed/feedService.test.ts`

**Interfaces:**

- Produces: `createFeedService({ sources, fetchXml?, parseXml?, ttlMs?, now? })` with `getFeed(): Promise<FeedArticle[]>`; `DEFAULT_FEED_SOURCES`.

- [x] Write failing tests for merge/sort, cross-source URL dedupe, one failing source, cache hits inside the TTL, refetch after expiry, and one shared refresh for concurrent callers.
- [x] Confirm RED.
- [x] Implement the 15-minute cache with single-flight refresh and per-source `try/catch`.
- [x] Fix the cold-cache bug where `cachedAt = 0` looked fresh under an injected clock (`Number.NEGATIVE_INFINITY`).
- [x] Confirm GREEN (6 tests).

### Task 4: Expose the public route and wire the composition root

**Files:**

- Create: `server/src/routes/feed.ts`
- Test: `server/src/routes/feed.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**

- Consumes: `FeedService`.
- Produces: `createFeedRouter({ service })` mounted at `/api/v1/feed`.

- [x] Write failing tests for anonymous access, `limit` handling, and ignored invalid limits.
- [x] Confirm RED.
- [x] Implement the router and inject it through `registerRoutes` from `index.ts`.
- [x] Confirm GREEN and run the full server suite (26 files / 87 tests).

### Task 5: Render the Home feed view, copy, and styles

**Files:**

- Create: `src/feed/types.ts`
- Create: `src/feed/feedView.ts`
- Test: `src/feed/feedView.test.ts`
- Modify: `src/api/client.ts`, `src/api/client.test.ts`
- Modify: `src/i18n/vi.ts`, `src/i18n/en.ts`
- Modify: `src/main.ts`, `index.html`
- Create: `src/styles/feed.css`
- Modify: `src/styles/main.css`, `src/styles/home.css`

**Interfaces:**

- Consumes: `api.feed.list(limit?)`.
- Produces: `initFeed({ container, load, t?, formatTime? })`, `repaintFeed()`, and `timeAgoLabel(publishedAt, now)`.

- [x] Write failing tests for skeleton, XSS escaping, new-tab link attributes, chip filtering, empty/error/retry, language repaint, and relative time.
- [x] Confirm RED.
- [x] Implement the view with an injectable `t`/`formatTime`, unit-testable pure helpers, and `esc()` everywhere.
- [x] Add bilingual copy and wire the view into the Home section; make the Home view scroll.
- [x] Confirm GREEN and run typecheck plus both builds.

### Task 6: Upgrade the feed UI and clean excerpts

**Files:**

- Modify: `src/feed/feedView.ts`, `src/feed/feedView.test.ts`
- Modify: `src/styles/feed.css`, `src/i18n/vi.ts`, `src/i18n/en.ts`
- Modify: `server/src/modules/feed/parser.ts`, `server/src/modules/feed/parser.test.ts`

**Interfaces:**

- Produces: List/Grid toggle with list as the default, article count, reading-time meta, and parser-side markdown/title cleanup.

- [x] Write failing tests for the list layout, source count, reading time, and the view switch.
- [x] Confirm RED.
- [x] Implement the layout switch and meta line; add parser cleanup tests for markdown artifacts and duplicated titles.
- [x] Confirm GREEN on both suites.
- [x] Commit `refactor: nâng cấp UI feed dạng list + làm sạch tóm tắt` (`ea3b6aa`).

### Task 7: Remove monogram tiles

**Files:**

- Modify: `src/feed/feedView.ts`, `src/feed/feedView.test.ts`, `src/styles/feed.css`

- [x] Flip the tile assertion to expect `.feed-tile` to be absent.
- [x] Confirm RED, remove the tile markup and unused source-color map, then confirm GREEN.
- [x] Commit `refactor: bỏ tile monogram khỏi item feed` (`ffc7560`).

### Task 8: Add the browser tab icon

**Files:**

- Create: `public/favicon.svg`
- Modify: `index.html`

- [x] Add a brand-aligned SVG favicon and link it with `type="image/svg+xml"`, plus a `theme-color` meta.
- [x] Verify the asset returns `200 image/svg+xml` and renders correctly.
- [x] Commit `feat: thêm favicon cho web` (`66fbdf0`).

### Task 9: Make blank environment values mean "unset"

**Files:**

- Modify: `server/src/config/env.ts`, `server/src/config/env.test.ts`

- [x] Write a failing test proving a copied `.env.example` with blank OAuth/SMTP placeholders still loads.
- [x] Confirm RED, normalize blank values to `undefined` before schema parsing, and confirm GREEN.
- [x] Commit `fix: coi giá trị env rỗng như chưa cấu hình` (`5a5e21d`).

### Task 10: Sync process documentation

**Files:**

- Create: `docs/ADR-003-public-rss-feed.md`
- Create: `docs/superpowers/specs/2026-09-12-home-rss-feed-design.md`
- Create: this plan
- Modify: `AGENTS.md`, `README.md`

- [x] Record the content boundary and technical shape in ADR-003.
- [x] Write the feature spec with approved decisions, interfaces, policy, and verification evidence.
- [x] Write this plan with commit references.
- [x] Add the feed to the product description, constraints, and architecture references in `AGENTS.md`.
- [x] Document the feed endpoint, source list, cache TTL, and content policy in `README.md`.

---

## Verification

- [x] `npm test` — 8 files / 24 tests.
- [x] `npm --prefix server test` — 26 files / 87 tests.
- [x] `npm run typecheck`, `npm --prefix server run typecheck`, `npm run build`, `npm --prefix server run build`.
- [x] `npm run format:check` and `npm run lint`.
- [x] Manual smoke test against live sources on `localhost:5173`.
- [x] Merged to `main` via PR #3 (`9a2c418`); feature branch removed locally and on the remote.
