# Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an in-app admin panel with a dashboard and user management (roles, disable), protected by the existing session auth.

**Architecture:** Add an `admin` repository + three authenticated admin routes on the server, and an `#adminView` section (Dashboard + Users tabs) in the Vite app. Disabling an account revokes its sessions and blocks login.

**Tech Stack:** TypeScript, Express 5, PostgreSQL, Vite 7, Vitest, supertest, Zod.

**Spec:** `docs/superpowers/specs/2026-09-12-admin-panel-design.md`

## Global Constraints

- Every admin route runs `requireAuth` then `requireAdmin` server-side.
- `users.disabled` blocks login; disable revokes sessions.
- An admin cannot demote or disable their own account.
- `search` matches email/display name case-insensitively; `limit` defaults 50, clamped 1–100.
- All rendered strings are escaped; copy lives in `src/i18n/{vi,en}.ts`.
- Database changes are append-only; migration `010_add_user_disabled.sql`.
- `npm run check` is the definition of green. Work happens on branch `feat/admin-panel`.

---

### Task 1: Migration and admin repository

**Files:**

- Create: `server/migrations/010_add_user_disabled.sql`
- Create: `server/src/modules/admin/adminRepository.ts`
- Test: `server/src/modules/admin/adminRepository.test.ts`

**Interfaces:**

- Produces `createAdminRepository({ query })` with:
  - `stats(): Promise<AdminStats>` — `AdminStats = { totalUsers, totalAdmins, activeSessions, dailyCompletionsToday }`
  - `listUsers({ search, limit, offset }): Promise<{ total: number; items: AdminUserRow[] }>`
  - `findById(userId): Promise<AdminUserRow | null>`
  - `setRole(userId, role: 'user' | 'admin'): Promise<void>`
  - `setDisabled(userId, disabled: boolean): Promise<void>` — when `disabled` is true also `DELETE FROM sessions WHERE user_id = $1`.

- [ ] **Step 1: Write migration SQL**

`server/migrations/010_add_user_disabled.sql`:

```sql
-- Cờ khóa tài khoản dùng cho admin panel.

ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Write the failing repository test**

`server/src/modules/admin/adminRepository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createAdminRepository } from './adminRepository';

describe('createAdminRepository', () => {
  it('computes admin stats in one round-trip', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          total_users: '10',
          total_admins: '2',
          active_sessions: '5',
          daily_completions: '3',
        },
      ],
    });
    const repo = createAdminRepository({ query });

    const stats = await repo.stats();

    expect(query).toHaveBeenCalledWith(expect.stringContaining('COUNT'), expect.any(Array));
    expect(stats).toEqual({
      totalUsers: 10,
      totalAdmins: 2,
      activeSessions: 5,
      dailyCompletionsToday: 3,
    });
  });

  it('lists users with search and provider aggregation', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: '7' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'u1',
            email: 'a@b.c',
            display_name: 'A',
            role: 'admin',
            disabled: false,
            email_verified_at: null,
            last_seen_at: '2026-09-12T00:00:00.000Z',
            providers: 'google,facebook',
          },
        ],
      });
    const repo = createAdminRepository({ query });

    const result = await repo.listUsers({ search: 'a@b', limit: 50, offset: 0 });

    expect(result.total).toBe(7);
    expect(result.items[0]).toMatchObject({
      id: 'u1',
      email: 'a@b.c',
      role: 'admin',
      providers: ['google', 'facebook'],
    });
  });

  it('disables a user and revokes their sessions', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = createAdminRepository({ query });

    await repo.setDisabled('u1', true);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), ['u1']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM sessions'), ['u1']);
  });
});
```

- [ ] **Step 3: Run to verify RED** — `npm --prefix server test -- src/modules/admin/adminRepository.test.ts` → FAIL missing module.
- [ ] **Step 4: Implement `adminRepository.ts`** with parameterized SQL and `Number()` coercion on count columns; `providers` splits a comma-joined aggregate by `,`.
- [ ] **Step 5: Run to verify GREEN**, then `npm --prefix server run migrate`.
- [ ] **Step 6: Commit** — `git add server/migrations/010_add_user_disabled.sql server/src/modules/admin && git commit -m "feat: migration và repository admin"`.

### Task 2: Admin routes and composition wiring

**Files:**

- Create: `server/src/routes/admin.ts`
- Test: `server/src/routes/admin.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**

- Consumes: `AdminRepository` from Task 1, `requireAuth`, `requireAdmin`.
- Produces: `createAdminRouter({ repo, requireAuth, requireAdmin })` mounted at `/api/v1/admin`.

- [ ] **Step 1: Write the failing route test**

`server/src/routes/admin.test.ts`:

```ts
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAdminRouter } from './admin';

const admin: RequestHandler = (req, _res, next) => {
  req.user = { userId: 'admin-1', email: 'admin@x.y', role: 'admin' };
  next();
};
const userOnly: RequestHandler = (req, _res, next) => {
  req.user = { userId: 'user-1', email: 'u@x.y', role: 'user' };
  next();
};

function app(repo: Parameters<typeof createAdminRouter>[0]['repo'], auth = admin) {
  const instance = express();
  instance.use(express.json());
  instance.use(
    '/admin',
    createAdminRouter({
      repo,
      requireAuth: auth,
      requireAdmin: auth === admin ? admin : (_r, _s, next) => next(),
    }),
  );
  return instance;
}
```

Hmm — the 403 test needs a requireAdmin that rejects non-admin. Simpler: build a tiny router in tests with real guard behavior:

```ts
function app(repo, role: 'admin' | 'user' = 'admin') {
  const instance = express();
  instance.use(express.json());
  const requireAuth: RequestHandler = (req, _res, next) => {
    req.user = { userId: role === 'admin' ? 'admin-1' : 'user-1', email: 'a@b.c', role };
    next();
  };
  const requireAdmin: RequestHandler = (req, res, next) => {
    if (req.user!.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  };
  instance.use('/admin', createAdminRouter({ repo, requireAuth, requireAdmin }));
  return instance;
}
```

- [ ] **Step 2: Run to verify RED** — `npm --prefix server test -- src/routes/admin.test.ts` → FAIL missing module.
- [ ] **Step 3: Implement `admin.ts`** — `GET /stats`, `GET /users`, `PATCH /users/:id`; self-modification check compares `req.params.id` to `req.user!.userId`; validate body with Zod (`role` enum optional, `disabled` boolean optional, at least one present).
- [ ] **Step 4: Run to verify GREEN** and run the full server suite.
- [ ] **Step 5: Wire `index.ts`** — `createAdminRouter({ repo: createAdminRepository({ query: pool.query.bind(pool) }), requireAuth, requireAdmin })`, mounted `app.use('/api/v1/admin', identity.adminRoutes)`.
- [ ] **Step 6: Commit** — `git commit -m "feat: routes admin dashboard và users"`.

### Task 3: Block login for disabled users

**Files:**

- Modify: `server/src/modules/identity/authService.ts`
- Modify: `server/src/modules/identity/authRoutes.ts`
- Test: `server/src/modules/identity/authService.test.ts`

**Interfaces:**

- Consumes: `UserRecord` gains `disabled?: boolean`; `PublicUser` stays unchanged.
- Produces: login throws `account_disabled` when `user.disabled`; `publicAuthError` maps it to 403 `{ code: 'account_disabled' }`.

- [ ] **Step 1: Add the failing test** in `authService.test.ts` — a `findByEmail` returning `{ ...user, disabled: true }` makes `login` reject with code `account_disabled`.
- [ ] **Step 2: Run to verify RED.**
- [ ] **Step 3: Implement** — in `login`, after the user lookup and before `issueSession`: `if (user.disabled) throw codedError('account_disabled');` and add the mapping in `authRoutes.publicAuthError` (403).
- [ ] **Step 4: Run to verify GREEN** plus server suite.
- [ ] **Step 5: Commit** — `git commit -m "feat: chặn đăng nhập tài khoản bị khóa"`.

### Task 4: Admin API client

**Files:**

- Modify: `src/api/client.ts`
- Test: `src/api/client.test.ts`

**Interfaces:**

- Produces `api.admin.stats()`, `api.admin.users(params)`, `api.admin.updateUser(id, patch)` with paths `/admin/stats`, `/admin/users`, `/admin/users/:id`.

- [ ] **Step 1: Add failing client tests** asserting the three request shapes.
- [ ] **Step 2: Run to verify RED.**
- [ ] **Step 3: Implement in `client.ts`.**
- [ ] **Step 4: Run to verify GREEN; commit** — `git commit -m "feat: api client cho admin panel"`.

### Task 5: Admin view, copy, styles, topbar

**Files:**

- Create: `src/admin/adminView.ts`
- Test: `src/admin/adminView.test.ts`
- Create: `src/styles/admin.css`
- Modify: `src/styles/main.css`, `index.html`, `src/main.ts`, `src/i18n/vi.ts`, `src/i18n/en.ts`

**Interfaces:**

- Consumes: `api.admin.*`, `esc`.
- Produces: `openAdminView(): Promise<void>` — fetches stats + users and renders the Dashboard and Users tabs; user actions call `api.admin.updateUser`.

**Copy (verbatim):**

- `admin.title`: `Quản trị` / `Admin`
- `admin.dashboard`: `Tổng quan` / `Dashboard`
- `admin.users`: `Người dùng` / `Users`
- `admin.totalUsers`: `Người dùng` / `Users`
- `admin.totalAdmins`: `Admin` / `Admins`
- `admin.activeSessions`: `Session hoạt động` / `Active sessions`
- `admin.dailyToday`: `Hoàn thành hôm nay` / `Completed today`
- `admin.searchUsers`: `Tìm theo email hoặc tên…` / `Search by email or name…`
- `admin.role`: `Vai trò` / `Role`
- `admin.status`: `Trạng thái` / `Status`
- `admin.enabled`: `Hoạt động` / `Active`
- `admin.disabled`: `Đã khóa` / `Disabled`
- `admin.disableConfirm`: `Khóa tài khoản này? Session của họ sẽ bị thu hồi.` / `Disable this account? Their sessions will be revoked.`
- `admin.lastActive`: `Hoạt động cuối` / `Last active`
- `admin.never`: `chưa từng` / `never`
- `admin.loadError`: `Không tải được dữ liệu quản trị.` / `Could not load admin data.`

- [ ] **Step 1: Write the failing view test** (jsdom + localStorage stub + dynamic import, like `feedView.test.ts`): renders stat cards from injected stats; renders user rows with escaped email; clicking the disable toggle calls the injected `updateUser` and re-renders.
- [ ] **Step 2: Run to verify RED.**
- [ ] **Step 3: Implement `adminView.ts`** — tabs, stat cards, user table with role `<select>` and a disable toggle button; `confirm()` before disabling.
- [ ] **Step 4: Add `#adminBtn` to `index.html` topbar (class `admin-only`, `hidden`), `#adminView` section; wire `openAdminView` in `src/main.ts`; add `admin.css` and import it.
- [ ] **Step 5: Run frontend suite + typecheck + build; commit** — `git commit -m "feat: giao diện admin panel"`.

### Task 6: Integration verification and documentation

**Files:**

- Modify: `README.md` (admin endpoints + view).
- Test: none new.

- [ ] **Step 1: Run `npm run check`** end-to-end.
- [ ] **Step 2: Manual smoke** — admin login → Admin view → counts render; promote/demote a test user; disable/enable; verify disabled user login is rejected.
- [ ] **Step 3: Update README** with the admin endpoints and panel.
- [ ] **Step 4: Commit** — `git commit -m "docs: cập nhật README cho admin panel"`.

---

## Verification

- [ ] Server: repository + routes + auth tests green.
- [ ] Frontend: admin view + client tests green.
- [ ] `npm run check` passes end-to-end.
- [ ] Manual smoke: dashboard renders; role change + disable/enable work; disabled login blocked.
