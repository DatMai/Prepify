# Home RSS Feed Design

**Date:** 2026-09-12
**Status:** Approved and implemented
**Supersedes scope of:** none (complements `2026-09-12-prepify-full-overhaul-design.md`, which reserved the "Home/public feed shell" as an anonymous-readable surface)
**Decision record:** `docs/ADR-003-public-rss-feed.md`

## Goal

Put a professional programming news feed on the public Home page so the reading
desk shows current content from curated Vietnamese and English sources, while
never republishing third-party work.

## Non-goals

- No full-text reader, no translation, no AI summaries.
- No database storage of articles and no admin UI for sources yet.
- No per-user personalization, bookmarks, or read state.
- No third-party images, avatars, or hosted media.

## Approved decisions

Captured from the brainstorming dialogue before implementation:

| Question                       | Decision                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where do sources come from?    | Started as admin-managed in PostgreSQL; **downgraded for the MVP** to a source list in code (`server/src/modules/feed/sources.ts`) to keep the first slice small. |
| How do users consume items?    | Link out to the original article in a new tab.                                                                                                                    |
| How fresh is the data?         | Short-TTL cache with on-demand refresh.                                                                                                                           |
| How is the Home feed laid out? | A single timeline with source filter chips.                                                                                                                       |
| How much is retained?          | 14 days / 500 articles was proposed; **dropped** because the MVP keeps no article rows.                                                                           |
| Default layout and thumbnails? | List-first with a List/Grid toggle; monogram tiles were implemented, then **removed** on review feedback.                                                         |

## Architecture

One Express process, one Vite frontend, no new infrastructure.

```text
Browser -> GET /api/v1/feed (public)
        -> Express feed router
        -> feed service (in-memory cache, TTL 15 min, single-flight)
        -> feed fetcher (http/https only, 10s timeout, 1 MB cap)
        -> RSS/Atom sources (VnExpress Số hóa, Viblo, TopDev, Hacker News, dev.to)
```

### Components

| Unit    | File                                     | Responsibility                                                                                                                                      |
| ------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types   | `src/feed/types.ts`                      | `FeedArticle` contract shared with the API client.                                                                                                  |
| Parser  | `server/src/modules/feed/parser.ts`      | Parse RSS 2.0 and Atom via `rss-parser`; normalize, strip HTML/markdown, drop a leading duplicated title, truncate to 280 chars, sort newest first. |
| Fetcher | `server/src/modules/feed/fetcher.ts`     | Reject non-`http(s)` URLs, abort after 10s, reject bodies over 1 MB, send an identifying `User-Agent`.                                              |
| Service | `server/src/modules/feed/feedService.ts` | Merge sources, dedupe by URL, isolate per-source failures, serve a 15-minute cache with a single in-flight refresh.                                 |
| Sources | `server/src/modules/feed/sources.ts`     | The curated `{ name, url }` list.                                                                                                                   |
| Route   | `server/src/routes/feed.ts`              | `GET /` public; `limit` defaults to 30, clamped to 1–50.                                                                                            |
| View    | `src/feed/feedView.ts`                   | Render header, source chips, List/Grid toggle, cards, skeleton, empty and error states.                                                             |
| Styles  | `src/styles/feed.css`                    | List and grid layouts, brand-agnostic card styling, shimmer skeleton, reduced-motion and mobile handling.                                           |

### Interfaces

- `GET /api/v1/feed?limit=<1..50>` → `{ items: FeedArticle[] }`.
- `FeedArticle` = `{ title, url, summary, source, publishedAt }`.
- `parseFeedXml(source: string, xml: string): Promise<FeedArticle[]>`.
- `createFeedFetcher({ fetchImpl?, timeoutMs?, maxBytes? }): { fetchXml(url) }`.
- `createFeedService({ sources, fetchXml?, parseXml?, ttlMs?, now? }): { getFeed() }`.

## Content policy

This is a product boundary, not just a UI choice (see ADR-003):

- Show source name, title, short excerpt, time, and a link to the original.
- Never republish or translate a third party's full article.
- Never host or hotlink third-party images; visualize with Prepify-owned styling.
- Attribution does not replace permission, so anything beyond a short excerpt
  requires the author's consent or a permissive license.

## Error handling

- A failing source yields an empty batch for that source only; the rest of the
  feed still renders.
- The route returns the cached list on refresh failure; the UI shows an error
  state with a retry button only when the request itself fails.
- Malformed items without a title or link are skipped.

## UI and UX

- Section header with kicker, title, article count, and a List/Grid toggle.
- List (default): one row per article — meta line (`SOURCE · time ago · N min read`),
  two-line title link, two-line excerpt.
- Grid: same content in responsive cards (`minmax(300px, 1fr)`).
- Source chips filter client-side; the active chip is accented.
- Skeleton shimmer while loading, dashed empty state, error state with retry.
- All dynamic text passes through `esc()`; every link opens in a new tab with
  `rel="noopener noreferrer"`.
- Vietnamese and English strings live in `src/i18n/{vi,en}.ts`.

## Testing

TDD for every unit, plus route and view tests:

- `parser.test.ts` — RSS 2.0 and Atom normalization, skipped items, sorting,
  truncation, markdown cleanup, duplicated-title removal.
- `fetcher.test.ts` — protocol rejection, success, non-2xx, size cap, timeout abort.
- `feedService.test.ts` — merge/sort, cross-source dedupe, isolated source failure,
  TTL cache hit, TTL expiry, single-flight.
- `feed.test.ts` — public access, limit handling, invalid limits.
- `client.test.ts` — `api.feed.list()` hits `/feed?limit=30`.
- `feedView.test.ts` — skeleton, escaping, link attributes, chip filtering,
  empty/error/retry, language repaint, list/grid switch, relative time.

## Verification

- Frontend: 8 files / 24 tests. Server: 26 files / 87 tests.
- `npm run typecheck`, `npm --prefix server run typecheck`, both builds,
  `format:check`, and `lint` are clean.
- Manual smoke test on `localhost:5173` with live sources: 5 sources rendered,
  chip filtering works, links open externally.

## Follow-ups (require a new ADR)

- Admin-managed sources and article storage in PostgreSQL, with retention.
- Server-side IP-level SSRF hardening if sources ever become user-supplied.
- Per-source branding colors or richer source metadata.
