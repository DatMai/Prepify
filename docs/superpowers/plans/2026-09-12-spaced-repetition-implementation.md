# Spaced Repetition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a review schedule to every quiz interaction and an Ôn tập queue that feeds the existing streak.

**Architecture:** The server is the scheduling authority for logged-in users (new append-only migration + review module + two authenticated routes). The frontend mirrors the pure scheduler for guests (localStorage) and renders a review overlay plus a topbar button with a due-count badge. Quiz grading hooks feed the scheduler.

**Tech Stack:** TypeScript, Express 5, PostgreSQL, Vite 7, Vitest, supertest, existing `dateInTimeZone` from `server/src/modules/learning/streak.ts`.

**Spec:** `docs/superpowers/specs/2026-09-12-spaced-repetition-design.md`

## Global Constraints

- Interval = 1 for Again; new-card Hard = 3, new-card Good = 7; known-card Hard = round(interval × 1.5), known-card Good = round(interval × ease). Round to nearest integer, minimum 1, maximum 180.
- Ease starts 2.5; Again − 0.2, Hard − 0.15, Good + 0.05; clamp to [1.3, 3.0].
- New card = `reviewCount === 0`.
- `dueAt = now + interval` calendar days, computed with the configured time zone via `dateInTimeZone`.
- Database changes are append-only; migration `009_add_review_schedules.sql`.
- Every grade records a study day (idempotent insert into `study_days`).
- All rendered strings are escaped; copy lives in `src/i18n/{vi,en}.ts`.
- `npm run check` is the definition of green. Work happens on branch `feat/spaced-repetition`.

---

### Task 1: Server scheduler (pure SM-2)

**Files:**
- Create: `server/src/modules/review/scheduler.ts`
- Test: `server/src/modules/review/scheduler.test.ts`

**Interfaces:**
- Produces: `type ReviewQuality = 'again' | 'hard' | 'good'`, `interface ReviewSchedule { topic, sectionIdx, questionIdx, intervalDays, ease, reviewCount, dueAt }` and `applyGrade(current: ReviewSchedule | null, quality: ReviewQuality, dueAtIso: string): ReviewSchedule`. `dueAtIso` is passed in so the unit stays pure (the route computes it with `dateInTimeZone`).

- [ ] **Step 1: Write the failing test**

`server/src/modules/review/scheduler.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyGrade, type ReviewSchedule } from './scheduler';

const base: ReviewSchedule = {
  topic: 'javascript', sectionIdx: 0, questionIdx: 0,
  intervalDays: 1, ease: 2.5, reviewCount: 0, dueAt: '2026-09-12T10:00:00.000Z',
};

describe('applyGrade', () => {
  it('schedules a new card with again/hard/good', () => {
    expect(applyGrade(base, 'again', '2026-09-13T00:00:00.000Z')).toMatchObject({
      intervalDays: 1, ease: 2.3, reviewCount: 1, dueAt: '2026-09-13T00:00:00.000Z',
    });
    expect(applyGrade(base, 'hard', '2026-09-16T00:00:00.000Z')).toMatchObject({
      intervalDays: 3, ease: 2.35, reviewCount: 1,
    });
    expect(applyGrade(base, 'good', '2026-09-20T00:00:00.000Z')).toMatchObject({
      intervalDays: 7, ease: 2.55, reviewCount: 1,
    });
  });

  it('grows a known card with the ease factor and caps the interval at 180 days', () => {
    const known = { ...base, intervalDays: 10, ease: 2.5, reviewCount: 2 };
    expect(applyGrade(known, 'good', '2026-10-05T00:00:00.000Z')).toMatchObject({
      intervalDays: 25, reviewCount: 3,
    });
    const huge = { ...base, intervalDays: 150, ease: 2.0, reviewCount: 2 };
    expect(applyGrade(huge, 'good', 'x')).toMatchObject({ intervalDays: 180 });
  });

  it('resets to one day on again and clamps ease at 1.3', () => {
    const known = { ...base, intervalDays: 40, ease: 1.4, reviewCount: 5 };
    expect(applyGrade(known, 'again', 'x')).toMatchObject({
      intervalDays: 1, ease: 1.3, reviewCount: 6,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- src/modules/review/scheduler.test.ts`
Expected: FAIL with `Cannot find module './scheduler'`.

- [ ] **Step 3: Write minimal implementation**

`server/src/modules/review/scheduler.ts`:

```ts
export type ReviewQuality = 'again' | 'hard' | 'good';

export interface ReviewSchedule {
  topic: string;
  sectionIdx: number;
  questionIdx: number;
  intervalDays: number;
  ease: number;
  reviewCount: number;
  dueAt: string;
}

const MAX_INTERVAL = 180;
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;

const EASE_DELTA: Record<ReviewQuality, number> = {
  again: -0.2, hard: -0.15, good: 0.05,
};

export function applyGrade(
  current: ReviewSchedule | null,
  quality: ReviewQuality,
  dueAtIso: string,
): ReviewSchedule {
  const prev = current ?? {
    topic: '', sectionIdx: 0, questionIdx: 0,
    intervalDays: 1, ease: 2.5, reviewCount: 0, dueAt: dueAtIso,
  };
  const isNew = prev.reviewCount === 0;
  let interval: number;
  if (quality === 'again') interval = 1;
  else if (isNew) interval = quality === 'hard' ? 3 : 7;
  else interval = Math.round(prev.intervalDays * (quality === 'hard' ? 1.5 : prev.ease));
  interval = Math.min(MAX_INTERVAL, Math.max(1, interval));

  const ease = Math.min(MAX_EASE, Math.max(MIN_EASE, prev.ease + EASE_DELTA[quality]));

  return {
    topic: prev.topic,
    sectionIdx: prev.sectionIdx,
    questionIdx: prev.questionIdx,
    intervalDays: interval,
    ease,
    reviewCount: prev.reviewCount + 1,
    dueAt: dueAtIso,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix server test -- src/modules/review/scheduler.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/review/scheduler.ts server/src/modules/review/scheduler.test.ts
git commit -m "feat: thuật toán lịch ôn tập SM-2 phía server"
```

### Task 2: Frontend scheduler mirror (for guests)

**Files:**
- Create: `src/review/scheduler.ts`
- Test: `src/review/scheduler.test.ts`

**Interfaces:**
- Produces: `type ReviewQuality`, `interface ReviewSchedule`, `applyGrade(current, quality, dueAtIso)` — same names and math as Task 1 so both sides stay compatible.

- [ ] **Step 1: Copy Task 1's failing test into `src/review/scheduler.test.ts`** (same assertions; frontend suite runs jsdom but this unit is pure).
- [ ] **Step 2: Run to verify RED** — `npm test -- src/review/scheduler.test.ts` → FAIL missing module.
- [ ] **Step 3: Copy Task 1's `scheduler.ts` implementation into `src/review/scheduler.ts`** (identical math, duplicated deliberately for the guest path).
- [ ] **Step 4: Run to verify GREEN** — `npm test -- src/review/scheduler.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/review && git commit -m "feat: bản sao scheduler cho guest"`.

### Task 3: Migration and review repository

**Files:**
- Create: `server/migrations/009_add_review_schedules.sql`
- Create: `server/src/modules/review/reviewRepository.ts`
- Test: `server/src/modules/review/reviewRepository.test.ts`

**Interfaces:**
- Produces: `createReviewRepository(query: QueryLike)` with:
  - `find(userId, topic, sectionIdx, questionIdx): Promise<ReviewScheduleRow | null>`
  - `upsert(schedule: ReviewScheduleRow): Promise<ReviewScheduleRow>` — `INSERT ... ON CONFLICT (user_id, topic, section_idx, question_idx) DO UPDATE ... RETURNING *`
  - `listDue(userId: string, nowIso: string): Promise<ReviewScheduleRow[]>`
  - `ReviewScheduleRow = { topic, sectionIdx, questionIdx, intervalDays, ease, reviewCount, dueAt }` (camelCase from SQL aliases).

- [ ] **Step 1: Write migration SQL**

`server/migrations/009_add_review_schedules.sql`:

```sql
-- Lịch ôn tập theo SM-2 cho từng câu hỏi của mỗi user.

CREATE TABLE IF NOT EXISTS review_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic         TEXT NOT NULL,
  section_idx   INTEGER NOT NULL,
  question_idx  INTEGER NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 1,
  ease          DOUBLE PRECISION NOT NULL DEFAULT 2.5,
  due_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_count  INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, topic, section_idx, question_idx)
);

CREATE INDEX IF NOT EXISTS idx_review_due ON review_schedules (user_id, due_at);
```

- [ ] **Step 2: Write the failing repository test**

`server/src/modules/review/reviewRepository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createReviewRepository } from './reviewRepository';

const row = {
  topic: 'javascript', section_idx: 0, question_idx: 1,
  interval_days: 3, ease: 2.5, review_count: 1, due_at: '2026-09-15T00:00:00.000Z',
};

describe('createReviewRepository', () => {
  it('upserts and maps camelCase columns', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const repo = createReviewRepository({ query });

    const result = await repo.upsert({
      userId: 'u1', topic: 'javascript', sectionIdx: 0, questionIdx: 1,
      intervalDays: 3, ease: 2.5, reviewCount: 1, dueAt: '2026-09-15T00:00:00.000Z',
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), expect.any(Array));
    expect(result).toMatchObject({ topic: 'javascript', sectionIdx: 0, intervalDays: 3 });
  });

  it('lists due schedules for a user', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const repo = createReviewRepository({ query });

    const items = await repo.listDue('u1', '2026-09-15T00:00:00.000Z');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE user_id = $1 AND due_at <= $2'),
      ['u1', '2026-09-15T00:00:00.000Z'],
    );
    expect(items[0]).toMatchObject({ topic: 'javascript', questionIdx: 1 });
  });
});
```

- [ ] **Step 3: Run to verify RED** — `npm --prefix server test -- src/modules/review/reviewRepository.test.ts` → FAIL missing module.
- [ ] **Step 4: Implement `reviewRepository.ts`** with parameterized SQL matching the assertions (aliases `section_idx AS "sectionIdx"`, etc.).
- [ ] **Step 5: Run to verify GREEN** and also run `npm --prefix server run migrate` against the local database.
- [ ] **Step 6: Commit** — `git add server/migrations/009_add_review_schedules.sql server/src/modules/review && git commit -m "feat: migration và repository lịch ôn tập"`.

### Task 4: Review routes and composition wiring

**Files:**
- Create: `server/src/routes/review.ts`
- Test: `server/src/routes/review.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `ReviewRepository` from Task 3, `applyGrade` from Task 1, `dateInTimeZone` from `../modules/learning/streak`, `requireAuth`, a `recordStudyDay(userId)` callback.
- Produces: `createReviewRouter({ repo, requireAuth, timeZone, recordStudyDay })` mounted at `/api/v1/review`.

- [ ] **Step 1: Write the failing route test**

`server/src/routes/review.test.ts`:

```ts
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createReviewRouter } from './review';

const auth: RequestHandler = (req, _res, next) => {
  req.user = { userId: 'user-1', email: 'a@b.c', role: 'user' };
  next();
};

function app(repo: Parameters<typeof createReviewRouter>[0]['repo'], recordStudyDay = vi.fn()) {
  const instance = express();
  instance.use(express.json());
  instance.use('/review', createReviewRouter({ repo, requireAuth: auth, timeZone: 'UTC', recordStudyDay }));
  return instance;
}

describe('review routes', () => {
  it('requires auth and returns due schedules', async () => {
    const repo = { listDue: vi.fn().mockResolvedValue([{ topic: 'javascript', sectionIdx: 0, questionIdx: 0, intervalDays: 3, ease: 2.5, reviewCount: 1, dueAt: '2026-09-15T00:00:00.000Z' }]) };
    const res = await request(app(repo)).get('/review/due').expect(200);
    expect(res.body).toEqual({ count: 1, items: expect.any(Array) });
  });

  it('grades a card and records a study day', async () => {
    const repo = {
      listDue: vi.fn(),
      find: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ topic: 'javascript', sectionIdx: 0, questionIdx: 0, intervalDays: 7, ease: 2.55, reviewCount: 1, dueAt: '2026-09-19T00:00:00.000Z' }),
    };
    const recordStudyDay = vi.fn().mockResolvedValue(undefined);
    const res = await request(app(repo, recordStudyDay)).post('/review/grade')
      .send({ topic: 'javascript', sectionIdx: 0, questionIdx: 0, quality: 'good' }).expect(200);

    expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ intervalDays: 7 }));
    expect(recordStudyDay).toHaveBeenCalledWith('user-1');
    expect(res.body.schedule).toMatchObject({ intervalDays: 7, reviewCount: 1 });
  });

  it('rejects invalid quality values', async () => {
    const repo = { listDue: vi.fn(), find: vi.fn(), upsert: vi.fn() };
    await request(app(repo)).post('/review/grade')
      .send({ topic: 'javascript', sectionIdx: 0, questionIdx: 0, quality: 'nope' }).expect(400);
  });
});
```

- [ ] **Step 2: Run to verify RED** — `npm --prefix server test -- src/routes/review.test.ts` → FAIL missing module.
- [ ] **Step 3: Implement `server/src/routes/review.ts`**

Key logic: `GET /due` → `repo.listDue(userId, nowIso)` → `{ count: items.length, items }`.
`POST /grade` → validate `topic` string, integer indices ≥ 0, `quality` in the enum (else 400); `now = new Date()`; `today = dateInTimeZone(now, deps.timeZone)`; compute `dueIso = addDaysIso(today, interval)` (helper: parse `today`, add `intervalDays` calendar days, return ISO); load `repo.find`; `applyGrade(found, quality, dueIso)`; `repo.upsert({ userId, ...schedule })`; `await deps.recordStudyDay(userId)`; respond `{ schedule }`.

Helper `addDaysIso(todayIso: string, days: number): string` lives in the route file:

```ts
function addDaysIso(todayIso: string, days: number): string {
  const [y, m, d] = todayIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString();
}
```

- [ ] **Step 4: Run to verify GREEN**, then run the full server suite.
- [ ] **Step 5: Wire `index.ts`** — build `createReviewRouter({ repo: createReviewRepository({ query: pool.query.bind(pool) }), requireAuth, timeZone: config.timeZone, recordStudyDay: (userId) => recordStudyDay(userId, pool, config.timeZone) })` and mount `app.use('/api/v1/review', identity.reviewRoutes)` inside `registerRoutes`.
- [ ] **Step 6: Typecheck + full server suite**, then commit — `git commit -m "feat: endpoint ôn tập và ghi nhận study day"`.

### Task 5: Frontend review state and API client

**Files:**
- Create: `src/state/review.ts`
- Test: `src/state/review.test.ts`
- Modify: `src/api/client.ts`, `src/api/client.test.ts`
- Modify: `src/types/quiz.ts` if `ReviewSchedule` is shared there; otherwise import from `src/review/scheduler`.

**Interfaces:**
- Consumes: `applyGrade` from Task 2, `api.review.due()`, `api.review.grade(...)`.
- Produces:
  - `api.review.due(): Promise<{ count: number; items: ReviewSchedule[] }>` → `GET /review/due`
  - `api.review.grade(topic, sectionIdx, questionIdx, quality): Promise<{ schedule: ReviewSchedule }>` → `POST /review/grade`
  - `src/state/review.ts`: `loadReviewState()`, `dueCount()`, `gradeQuestion(topic, sectionIdx, questionIdx, quality): Promise<ReviewSchedule | null>` (server when logged in; local `applyGrade` + `localStorage` key `quiz:review` when guest), and `reviewState` mirroring `progress.ts`.

- [ ] **Step 1: Add failing client tests** — `api.review.due()` hits `http://localhost:3001/api/v1/review/due`; `api.review.grade(...)` POSTs with body `{ topic, sectionIdx, questionIdx, quality }`.
- [ ] **Step 2: Run to verify RED**.
- [ ] **Step 3: Implement `api.review.*` in `client.ts`**.
- [ ] **Step 4: Write failing state tests** (jsdom + localStorage stub + fetch mock): guest grade updates localStorage schedule with interval 7 for `good`; logged-in grade calls `api.review.grade` and replaces local state with the response.
- [ ] **Step 5: Implement `src/state/review.ts`** following `src/state/progress.ts` patterns (`isLoggedIn()` branch).
- [ ] **Step 6: Run to verify GREEN; commit** — `git commit -m "feat: state ôn tập và API client"`.

### Task 6: Hook grading into the existing quiz flow

**Files:**
- Modify: `src/quiz/quizView.ts`
- Test: `src/quiz/quizView.test.ts` (new, jsdom) — only if the hook is a small exported helper; otherwise cover via Task 5 tests.

**Interfaces:**
- Consumes: `gradeQuestion` from Task 5.
- Produces: no new public API.

- [ ] **Step 1:** In `quizView.ts` MCQ answer branch (where `isCorrect` is computed): call `void gradeQuestion(topicKey, sectionIdx, questionIdx, isCorrect ? 'good' : 'again')`.
- [ ] **Step 2:** In `handleFlashcardGrade(grade)`: call `void gradeQuestion(topicKey, sectionIdx, questionIdx, grade === 3 ? 'good' : grade === 2 ? 'hard' : 'again')`.
- [ ] **Step 3:** Run frontend suite + typecheck; commit — `git commit -m "feat: móc chấm điểm quiz vào lịch ôn tập"`.

### Task 7: Review UI — topbar button, overlay, copy, styles

**Files:**
- Create: `src/review/reviewView.ts`
- Test: `src/review/reviewView.test.ts`
- Create: `src/styles/review.css`
- Modify: `src/styles/main.css`, `index.html`, `src/main.ts`
- Modify: `src/i18n/vi.ts`, `src/i18n/en.ts`

**Interfaces:**
- Consumes: `loadReviewState`, `dueCount`, `gradeQuestion` from Task 5; `esc` from `src/render/escape`.
- Produces: `initReviewButton(onOpen)` — renders `#reviewBtn` badge; `openReviewOverlay(): Promise<void>` — shows one card at a time, reveal → 3 grade buttons, final summary.

**Copy (verbatim):**
- `review.title`: `Ôn tập` / `Review`
- `review.badge`: `{n}` (used as badge text)
- `review.empty`: `Không có câu nào đến hạn hôm nay.` / `No cards are due today.`
- `review.reveal`: `Hiện đáp án` / `Show answer`
- `review.again`: `Lại` / `Again`
- `review.hard`: `Khó` / `Hard`
- `review.good`: `Tốt` / `Good`
- `review.summary`: `Đã ôn {done} câu, còn {left} câu.` / `Reviewed {done}, {left} left.`
- `review.close`: `Đóng` / `Close`

- [ ] **Step 1: Write the failing view test** (dynamic import + localStorage stub like `feedView.test.ts`): renders due cards with escaped titles; clicking `review.again` calls `gradeQuestion` and advances; empty state renders `review.empty`; summary renders `review.summary` with counts.
- [ ] **Step 2: Run to verify RED.**
- [ ] **Step 3: Implement `reviewView.ts`** — overlay markup: `.review-overlay`, `.review-card`, `.review-question`, `.review-answer`, `.review-grade-btn[data-grade]`; keyboard 1/2/3 mirrors buttons.
- [ ] **Step 4: Add `#reviewBtn` to `index.html` topbar next to `#dailyBtn`; import `review.css` in `main.css`; wire button and overlay in `src/main.ts` (refresh badge after login and after grading).
- [ ] **Step 5: Run frontend suite + typecheck + build; commit** — `git commit -m "feat: giao diện ôn tập với badge và overlay"`.

### Task 8: Integration verification and documentation

**Files:**
- Modify: `README.md` (commands/architecture note about `/api/v1/review`), `docs/superpowers/specs/2026-09-12-spaced-repetition-design.md` if verification differs.
- Test: none new.

- [ ] **Step 1: Run the full gate** — `npm run check` (format, lint, typechecks, tests, builds, bundle scan, audit).
- [ ] **Step 2: Manual smoke** on `localhost:5173`: answer an MCQ in quiz mode, open Ôn tập, grade Good, verify the badge clears and `/health/ready` stays 200; verify streak date advances for today.
- [ ] **Step 3: Update README** with the two new endpoints and the guest-storage note.
- [ ] **Step 4: Commit** — `git commit -m "docs: cập nhật README cho ôn tập"`.

---

## Verification

- [ ] Server: scheduler + repository + route tests green (26 → 29 files).
- [ ] Frontend: scheduler + state + view tests green (8 → 12 files).
- [ ] `npm run check` passes end-to-end.
- [ ] Manual smoke: MCQ answer → due badge → grade → badge clears → streak recorded.
