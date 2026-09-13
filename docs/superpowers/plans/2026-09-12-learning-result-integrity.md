# Learning Result Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution status (2026-09-13):** complete on `feat/overhaul-completion` (PR #11).
> Daily submission integrity, the non-scored flashcard contract and migration 012
> are implemented and verified; scored MCQ history stays intentionally unavailable
> until a server-issued attempt protocol exists.

**Goal:** Prevent clients from forging scored quiz results and close remaining Daily grading edge cases.

**Architecture:** Daily keeps its sealed server-issued challenge. The unused legacy quiz-session endpoint is converted to accept only non-scored flashcard activity; client-asserted MCQ scores are rejected until a complete server-issued attempt protocol is introduced in a separate feature.

**Tech Stack:** Express 5, TypeScript, PostgreSQL, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-09-12-deployment-obsidian-on-demand-sync-design.md`

## Global Constraints

- Never persist a client-asserted score as trusted progress.
- Keep Daily answer keys sealed and server-graded.
- Use the injected application time zone.
- Add database changes only through a new append-only migration.
- Do not push.

---

### Task 1: Daily submission integrity

**Files:**

- Modify: `server/src/modules/daily/dailyChallenge.test.ts`
- Modify: `server/src/modules/daily/dailyChallenge.ts`
- Modify: `server/src/routes/daily.test.ts`

**Interfaces:**

- Consumes: `grade(token, userId, date, submissions)`.
- Produces: exactly one submission per challenge answer ID and rejects unknown or duplicated IDs.

- [x] **Step 1: Add failing boundary tests**

```ts
expect(() => codec.grade(token, 'user-1', date, [answer, answer])).toThrow('Invalid challenge');
expect(() =>
  codec.grade(token, 'user-1', date, [{ questionId: 'unknown', selectedIdx: 0 }]),
).toThrow('Invalid challenge');
```

Also prove omitted answers score zero without changing the signed total.

- [x] **Step 2: Run to verify RED**

Run: `npm --prefix server test -- src/modules/daily/dailyChallenge.test.ts src/routes/daily.test.ts`

Expected: duplicate and unknown submissions are currently accepted.

- [x] **Step 3: Implement exact-ID validation**

Before grading, compare the submitted IDs with the sealed ID set, reject unknown
IDs, reject duplicates, and retain missing answers as incorrect.

- [x] **Step 4: Run to verify GREEN and commit**

```bash
npm --prefix server test -- src/modules/daily/dailyChallenge.test.ts src/routes/daily.test.ts
git add server/src/modules/daily/dailyChallenge.ts server/src/modules/daily/dailyChallenge.test.ts server/src/routes/daily.test.ts
git commit -m "fix: xác thực đầy đủ câu trả lời Daily"
```

Task 1 evidence: the report records the original RED (2 failing tests for
duplicate/unknown submissions and an HTTP 500 route path), the GREEN result
(11/11 tests), and commit `d20b254`.

### Task 2: Non-scored flashcard activity contract

**Files:**

- Create: `server/migrations/012_make_quiz_score_nullable.sql`
- Create: `server/src/routes/quizSessions.test.ts`
- Modify: `server/src/routes/quizSessions.ts`
- Modify: `server/src/index.ts`
- Modify: `src/api/streak.ts`
- Modify: `src/api/client.test.ts`

**Interfaces:**

- Consumes: `{ topicKey: string, mode: 'flashcard', total: number }`.
- Produces: `{ id: string, completedAt: string }`; stored `score` is `NULL`.

- [x] **Step 1: Write failing route tests**

Create `createQuizSessionsRouter({ query, requireAuth })` and assert:

```ts
await request(app)
  .post('/quiz-sessions')
  .send({ topicKey: 'javascript', mode: 'mcq', total: 5, score: 5 })
  .expect(422);
await request(app)
  .post('/quiz-sessions')
  .send({ topicKey: 'javascript', mode: 'flashcard', total: 5 })
  .expect(201);
expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO quiz_sessions'), [
  'user-1',
  'javascript',
  'flashcard',
  5,
]);
```

- [x] **Step 2: Run to verify RED**

Run: `npm --prefix server test -- src/routes/quizSessions.test.ts`

Expected: FAIL because the current singleton router accepts scored MCQ payloads.

- [x] **Step 3: Add the append-only migration**

```sql
ALTER TABLE quiz_sessions ALTER COLUMN score DROP NOT NULL;
```

- [x] **Step 4: Convert the route to an injected factory**

Export:

```ts
export function createQuizSessionsRouter(deps: {
  query: QuizSessionQuery;
  requireAuth: RequestHandler;
}): Router;
```

Reject `mode !== 'flashcard'` or any payload containing `score` with code
`scored_attempt_required`. Insert only `user_id`, `topic_key`, `mode`, and
`total`. Return nullable score from history.

- [x] **Step 5: Wire the router and narrow the browser type**

Replace `QuizSessionPayload` with:

```ts
export interface FlashcardActivityPayload {
  topicKey: string;
  mode: 'flashcard';
  total: number;
}
```

Create the router in `server/src/index.ts` with the pool-bound query and
`requireAuth`.

- [x] **Step 6: Run migration, focused tests, and typechecks**

```bash
npm --prefix server run migrate
npm --prefix server test -- src/routes/quizSessions.test.ts
npm test -- src/api/client.test.ts
npm run typecheck
npm --prefix server run typecheck
```

- [x] **Step 7: Commit**

```bash
git add server/migrations/012_make_quiz_score_nullable.sql server/src/routes/quizSessions.ts server/src/routes/quizSessions.test.ts server/src/index.ts src/api/streak.ts src/api/client.test.ts
git commit -m "fix: chặn điểm quiz do client tự khai"
```

Task 2 evidence: the report records the original RED (scored MCQ accepted and
scoreless flashcard activity rejected), the GREEN tests/typechecks, and commit
`f7e0358`. Migration `012_make_quiz_score_nullable.sql` was subsequently
applied successfully in the local configured database on 2026-09-12.

### Task 3: Learning integrity verification

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-12-overhaul-release-completion.md`

**Interfaces:**

- Consumes: Tasks 1–2 and fresh verification.
- Produces: truthful API documentation and completed release-plan Task 3.

- [x] **Step 1: Verify time-zone boundaries remain green**

Run: `npm --prefix server test -- src/modules/learning/streak.test.ts src/routes/daily.test.ts`

- [x] **Step 2: Run the full gate**

Run: `npm run check`

Expected: exit 0 with no high production vulnerability.

- [x] **Step 3: Update documentation and commit**

Document that scored MCQ history is intentionally unavailable until the server
issues attempts. Mark release-plan Task 3 only after every command above passes.

```bash
git add README.md docs/superpowers/plans/2026-09-12-overhaul-release-completion.md
git commit -m "docs: ghi nhận tính toàn vẹn kết quả học"
```

Task 3 evidence: the focused boundary command passed 2 files/13 tests and the
full gate passed. Scored MCQ history remains intentionally unavailable until
the server issues attempts. The local-midnight RED is retrospective mutation
evidence; no historical pre-GREEN RED claim is made for commit `03ccb20`.
