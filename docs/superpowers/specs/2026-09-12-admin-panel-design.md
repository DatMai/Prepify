# Admin Panel Design

**Date:** 2026-09-12
**Status:** Approved
**Complements:** `docs/superpowers/specs/2026-09-12-prepify-full-overhaul-design.md` (admin-only surfaces, server-enforced authorization)

## Goal

Give the owner an in-app admin panel to run the product: a dashboard of key
counts plus user management (roles and account disabling), reusing the existing
session auth and `requireAdmin` guard.

## Non-goals

- No separate admin application or build; the panel lives inside the existing Vite app as a protected view.
- No feed source management, no sessions list UI, no audit table in this slice.
- No finer-grained roles beyond the existing `user` / `admin`.

## Approved decisions

| Question          | Decision                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| First slice       | Dashboard + Users & Roles.                                                                     |
| User actions      | Promote/demote admin, disable/enable an account, view OAuth providers and last activity.       |
| Disable semantics | `users.disabled` flag; disabled users cannot log in, and disabling revokes all their sessions. |
| Self-protection   | An admin cannot demote or disable their own account.                                           |
| Audit             | Deferred to the overhaul plan's `audit_events` (Task 5), not duplicated here.                  |

## Backend

Migration `010_add_user_disabled.sql` (append-only):

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
```

Module `server/src/modules/admin/adminRepository.ts` (dependency-injected
`query`, following `reviewRepository`):

- `stats(): Promise<AdminStats>` where
  `AdminStats = { totalUsers, totalAdmins, activeSessions, dailyCompletionsToday, reviewDue }`.
- `listUsers(input: { search: string; limit: number; offset: number })` →
  rows with `id, email, displayName, role, disabled, emailVerifiedAt, lastSeenAt, providers`
  (`providers` is an array of linked OAuth provider names; `lastSeenAt` is the
  max `last_seen_at` from `sessions`).
- `setRole(userId, role)`, `setDisabled(userId, disabled)`; `setDisabled(true)`
  also revokes that user's sessions.
- `findById(userId)` for the self-protection rule.

Routes `server/src/routes/admin.ts` (all `requireAuth + requireAdmin`):

- `GET /api/v1/admin/stats` → `AdminStats`.
- `GET /api/v1/admin/users?search=&limit=&offset=` → `{ total, items }`.
  `search` matches email or display name (case-insensitive), `limit` defaults
  to 50 and is clamped to 1–100.
- `PATCH /api/v1/admin/users/:id` body `{ role?, disabled? }` (at least one),
  rejects demoting/disabling `req.user.id` with 400 `self_modification`.

Login enforcement in `authService.login`: if `user.disabled`, throw
`account_disabled`; `authRoutes.publicAuthError` maps it to 403.

## Frontend

- Topbar button **Admin** (visible only to admins via the existing
  `updateAccessUI` mechanism) → opens the `#adminView` section.
- `src/admin/adminView.ts` renders two tabs:
  - **Dashboard** — stat cards (total users, admins, active sessions, today's
    completions, review due) and a health dot.
  - **Users** — search box, table rows with email, display name, role select,
    enable/disable toggle (confirm dialog), OAuth provider badges, and last
    active time.
- `src/api/client.ts` adds `api.admin.stats()`, `api.admin.users(params)`,
  `api.admin.updateUser(id, patch)`.
- Copy in `src/i18n/{vi,en}.ts`; styles in `src/styles/admin.css` imported from
  `main.css`.

## Security rules

- Every admin route checks `requireAuth` then `requireAdmin` on the server.
- The frontend guard is UX only; it never replaces server authorization.
- Self-demote and self-disable are rejected server-side.
- Disable revokes sessions immediately.

## Testing (TDD)

- `adminRepository.test.ts` — stats query, users search, role/disable updates,
  session revocation on disable.
- `admin.test.ts` — 401 without auth, 403 for non-admin, stats/users payloads,
  self-modification rejection.
- `authService.test.ts` addition — login rejected for disabled users.
- `adminView.test.ts` — dashboard rendering, user list rendering, toggle action
  calling the API, escaping of injected strings.
- `client.test.ts` addition — `api.admin.*` request shapes.

## Verification

- `npm run check` green: format, lint, both typechecks, both test suites, both
  builds, bundle scan, audit.
- Manual smoke: admin login → Admin view → dashboard counts render; promote a
  test user, then disable/enable them; confirm a disabled user cannot log in.

## Follow-ups (new design when needed)

- Feed source management in PostgreSQL (ADR-003 follow-up).
- Sessions list UI and one-click revoke.
- `audit_events` for admin actions (reuse the overhaul plan Task 5 schema).
